javascript
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { Octokit } = require('@octokit/rest');
const simpleGit = require('simple-git');
const fs = require('fs-extra');
const path = require('path');

// Ensure conversations.json is in .gitignore
const ensureGitignore = () => {
  const gitignorePath = path.join(__dirname, '.gitignore');
  const conversationsEntry = 'conversations.json';

  try {
    let gitignoreContent = '';
    if (fs.existsSync(gitignorePath)) {
      gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
    }

    if (!gitignoreContent.includes(conversationsEntry)) {
      fs.appendFileSync(gitignorePath, `\n${conversationsEntry}\n`);
    }
  } catch (error) {
    // Skip .gitignore update in read-only environments (like deployments)
    if (error.code === 'EROFS') {
      console.log('📝 Skipping .gitignore update (read-only file system)');
    } else {
      console.error('Error updating .gitignore:', error.message);
    }
  }
};

ensureGitignore();
const { exec } = require('child_process');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Startup logging
console.log('🚀 Starting AI Coding Assistant...');
console.log(`📦 Node.js version: ${process.version}`);
console.log(`🌐 Server will run on port: ${PORT}`);
console.log(`🔑 GitHub token configured: ${process.env.GITHUB_TOKEN ? 'Yes' : 'No'}`);
console.log(`🤖 DeepSeek API key configured: ${process.env.DEEPSEEK_API_KEY ? 'Yes' : 'No'}`);

// Rate limiting
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later'
});

// Input validation
const { body, validationResult } = require('express-validator');

// Middleware
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
  credentials: true
}));
app.use(limiter);
app.use(express.json({ limit: '10mb' })); // Reduced from 50mb
app.use(express.static('public'));

// Global error handler
app.use((err, req, res, next) => {
  console.error('Global error caught:', err);

  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      success: false,
      error: 'Invalid JSON format'
    });
  }

  if (err.code === 'ENOENT') {
    return res.status(404).json({
      success: false,
      error: 'Resource not found'
    });
  }

  if (err.code === 'EACCES') {
    return res.status(403).json({
      success: false,
      error: 'Access denied'
    });
  }

  // Default error response
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// Initialize GitHub client
let octokit;
try {
  if (process.env.GITHUB_TOKEN) {
    octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN
    });
    console.log('✅ GitHub client initialized successfully');
  } else {
    console.log('⚠️  GitHub token not found - GitHub features disabled');
  }
} catch (error) {
  console.error('❌ Failed to initialize GitHub client:', error.message);
}

// DeepSeek API configuration
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

// Memory file path
const MEMORY_FILE = path.join(__dirname, 'memory.json');

// Sanitize input strings to prevent path traversal and injection
function sanitizeInput(input, maxLength = 100) {
  if (!input || typeof input !== 'string') return 'default';
  return input
    .replace(/[^a-zA-Z0-9-_./]/g, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/\/{2,}/g, '/')
    .substring(0, maxLength)
    .toLowerCase();
}

// Get repository-specific memory file path
function getRepoMemoryFile(repoName) {
  const sanitizedName = sanitizeInput(repoName, 50);
  const fileName = `memory_${sanitizedName}.json`;
  console.log(`📂 Memory file for ${repoName}: ${fileName}`);
  return path.join(__dirname, fileName);
}

// Routes
app.get('/', (req, res) => {
  res.redirect('/index.html');
});

// CLI Interface with Preview
app.get('/cli', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'cli.html'));
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'Server is running',
    timestamp: new Date().toISOString(),
    github: !!process.env.GITHUB_TOKEN,
    deepseek: !!process.env.DEEPSEEK_API_KEY,
    port: PORT
  });
});

// Simplified memory context for better performance
async function getMemoryContext(repoName = 'default') {
  return { 
    conversations: [], 
    projectContext: 'AI Coding Assistant', 
    errors: [], 
    totalConversations: 0 
  };
}

// File locking mechanism to prevent race conditions
const fileLocks = new Map();

async function acquireLock(filePath) {
  while (fileLocks.has(filePath)) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  fileLocks.set(filePath, Date.now());
  // Add timeout to prevent deadlocks
  setTimeout(() => {
    if (fileLocks.get(filePath) && Date.now() - fileLocks.get(filePath) > 30000) {
      console.warn(`Force releasing lock for ${filePath} due to timeout`);
      releaseLock(filePath);
    }
  }, 30000);
}

function releaseLock(filePath) {
  fileLocks.delete(filePath);
}

// Simplified memory saving - async background operation
async function saveToMemory(repoName = 'default', role, content, metadata = {}) {
  // Skip memory saving for performance - conversations are handled separately
  return;
}

// Fast Code Analysis Endpoint
app.post('/api/analyze-code', async (req, res) => {
  try {
    if (!DEEPSEEK_API_KEY) {
      return res.status(503).json({ 
        success: false, 
        error: 'AI service unavailable - API key not configured' 
      });
    }

    const { code, language = 'javascript', action = 'fix' } = req.body;
    if (!code) {
      return res.status(400).json({
        success: false,
        error: 'Code is required'
      });
    }

    console.log(`🔧 Analyzing ${language} code (${code.length} chars)...`);

    const systemPrompt = `You are an expert ${language} developer. Analyze the provided code and ${action === 'fix' ? 'fix any errors' : 'suggest improvements'}.

RULES:
- Provide complete, working code
- Explain what was wrong and how you fixed it
- Use modern best practices
- Be concise but thorough`;

    const response = await axios.post(DEEPSEEK_API_URL, {
      model: 'deepseek-coder',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `${action === 'fix' ? 'Fix this code:' : 'Improve this code:'}\n\n${code}` }
      ],
      temperature: 0.1,
      max_tokens: 2500
    }, {
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    const result = response.data.choices[0].message.content;

    res.json({
      success: true,
      result: result,
      language: language,
      action: action,
      originalLength: code.length
    });

  } catch (error) {
    console.error('Code analysis error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.response?.data?.error || 'Code analysis failed' 
    });
  }
});

// AI Code Generation with Memory Context
app.post('/api/generate-code', async (req, res) => {
  try {
    if (!DEEPSEEK_API_KEY) {
      return res.status(503).json({ 
        success: false, 
        error: 'AI service unavailable - API key not configured' 
      });
    }

    const { prompt, language, context, repoName } = req.body;
    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters'
      });
    }

    // Check memory for context before generating code
    const memoryContext = await getMemoryContext(repoName);

    const enhancedContext = `
${memoryContext.projectContext}
${context ? 'Additional Context: ' + context : ''}
${memoryContext.errors.length > 0 ? 'Recent Errors Fixed: ' + memoryContext.errors.map(e => e.errorType || 'Unknown').join(', ') : ''}
Previous Context: ${memoryContext.conversations.slice(-3).map(c => `${c.role}: ${c.content.substring(0, 100)}`).join('\n')}
`.trim();

    const systemPrompt = `You are an expert ${language} programmer with full memory of this project. Generate clean, well-commented, production-ready code based on the user's request and project history.`;

    const response = await axios.post(DEEPSEEK_API_URL, {
      model: 'deepseek-coder',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `${enhancedContext}\n\nRequest: ${prompt}` }
      ],
      temperature: 0.1,
      max_tokens: 2000
    }, {
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const generatedCode = response.data.choices[0].message.content;

    // Save to memory
    await saveToMemory(repoName, 'user', prompt);
    await saveToMemory(repoName, 'assistant', `Generated ${language} code: ${generatedCode.substring(0, 200)}...`);

    res.json({
      success: true,
      code: generatedCode,
      language: language,
      memoryContext: memoryContext.totalConversations
    });
  } catch (error) {
    console.error('Code generation error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.response?.data?.error || error.message || 'Code generation failed' 
    });
  }
});

// Store conversation history per repository (persistent until project completion)
const projectConversations = new Map();
const CONVERSATIONS_FILE = path.join(__dirname, 'conversations.json');

// Load existing conversations from file
function loadConversations() {
  try {
    if (fs.existsSync(CONVERSATIONS_FILE)) {
      const data = fs.readFileSync(CONVERSATIONS_FILE, 'utf8');

      // Check if data looks like valid JSON
      if (!data.trim().startsWith('{') && !data.trim().startsWith('[')) {
        console.warn('Conversations file contains invalid JSON, resetting...');
        fs.writeFileSync(CONVERSATIONS_FILE, '{}');
        return;
      }

      const conversations = JSON.parse(data);

      // Ensure conversations is an object
      if (typeof conversations === 'object' && conversations !== null) {
        Object.entries(conversations).forEach(([key, value]) => {
          // Ensure value is an array before setting
          if (Array.isArray(value)) {
            projectConversations.set(key, value);
          }
        });
        console.log(`Loaded ${Object.keys(conversations).length} conversation histories`);
      }
    }
  } catch (error) {
    console.error('Error loading conversations:', error.message);
    console.log('Resetting conversations file...');
    try {
      fs.writeFileSync(CONVERSATIONS_FILE, '{}');
    } catch (writeError) {
      console.error('Failed to reset conversations file:', writeError.message);
    }
  }
}

// Save conversations to file
function saveConversations() {
  try {
    const conversations = Object.fromEntries(projectConversations);

    // Validate data before saving
    const jsonString = JSON.stringify(conversations, null, 2);

    // Write to temporary file first, then rename for atomic operation
    const tempFile = CONVERSATIONS_FILE + '.tmp';
    fs.writeFileSync(tempFile, jsonString);
    fs.renameSync(tempFile, CONVERSATIONS_FILE);

  } catch (error) {
    console.error('Error saving conversations:', error.message);
    // Clean up temp file if it exists
    try {
      const tempFile = CONVERSATIONS_FILE + '.tmp';
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    } catch (cleanupError) {
      console.error('Error cleaning up temp file:', cleanupError.message);
    }
  }
}

// Load conversations on startup
loadConversations();

// Enhanced Chat with Optimized Code Handling
app.post('/api/chat', [
  body('message').isLength({ min: 1, max: 50000 }).trim(), // Increased limit for code
  body('selectedRepo.full_name').optional().isLength({ max: 100 }).trim().matches(/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/)
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Invalid input',
        details: errors.array()
      });
    }

    if (!DEEPSEEK_API_KEY) {
      return res.status(503).json({ 
        success: false, 
        error: 'AI service unavailable - API key not configured' 
      });
    }

    const { message, selectedRepo, sessionId = 'default' } = req.body;
    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'Message is required'
      });
    }

    const conversationKey = selectedRepo ? selectedRepo.full_name : sessionId;

    // Get or create conversation history for this project
    if (!projectConversations.has(conversationKey)) {
      projectConversations.set(conversationKey, []);
    }
    const history = projectConversations.get(conversationKey);

    // Fast code detection - skip heavy memory operations for code
    const isCodePaste = message.length > 500 || 
      /```|function\s+\w+|class\s+\w+|import\s+|export\s+|const\s+\w+\s*=|let\s+\w+\s*=/.test(message);

    // Detect error patterns quickly
    const hasError = /error|Error|ERROR|exception|failed|undefined|syntax|cannot|missing|unexpected/.test(message);

    // Simplified system prompt for better performance
    let systemPrompt = `You are an expert AI coding assistant. Analyze code quickly and provide clear, actionable solutions.

INSTRUCTIONS:
- If user pasted code with errors: identify the specific issue and provide a working fix
- If user pasted working code: suggest improvements or explain functionality
- Be concise but thorough
- Always provide complete working code, not snippets
- Focus on the immediate problem

${hasError ? '🚨 ERROR DETECTED: Analyze the error and provide a complete fix.' : ''}
${isCodePaste ? '📝 CODE DETECTED: Review the code and provide specific feedback.' : ''}`;

    if (selectedRepo) {
      systemPrompt += `\n\nProject: ${selectedRepo.name} - I remember our previous conversations about this project.`;
    }

    // Simplified message handling for speed
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-6), // Reduced context for speed
      { role: 'user', content: message }
    ];

    console.log(`🤖 Processing ${isCodePaste ? 'code' : 'message'} (${message.length} chars)...`);

    const response = await axios.post(DEEPSEEK_API_URL, {
            model: 'deepseek-coder',
            messages: messages,
            temperature: 0.1,
            max_tokens: isCodePaste ? 2000 : 1200,
            stream: false
        }, {
            headers: {
                'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 15000 // Reduced timeout to 15 seconds
        });

        // Safely extract AI response
        const aiResponse = response.data?.choices?.[0]?.message?.content || 'No response received';

        // Validate response
        if (!aiResponse || aiResponse.trim() === '') {
            throw new Error('Empty response from AI service');
        }

    // Simplified memory management
    history.push({ 
      role: 'user', 
      content: message.substring(0, 1000), // Truncate for storage
      timestamp: new Date().toISOString()
    });
    history.push({ 
      role: 'assistant', 
      content: aiResponse.substring(0, 1000),
      timestamp: new Date().toISOString()
    });

    // Keep only recent history for performance
    if (history.length > 20) {
      history.splice(0, history.length - 20);
    }

    // Async save - don't block response
    setImmediate(() => {
      try {
        saveConversations();
      } catch (e) {
        console.error('Background save failed:', e.message);
      }
    });

    res.json({
      success: true,
      response: aiResponse,
      metadata: {
        isCodePaste,
        hasError,
        messageLength: message.length,
        processingTime: 'optimized'
      }
    });

} catch (error) {
        console.error('Chat error:', error);

        // Better error handling
        if (error.code === 'ECONNRESET' || error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
            return res.status(408).json({ 
                success: false, 
                error: 'Request timeout - try shorter messages or simpler requests' 
            });
        }

        if (error.response?.status === 429) {
            return res.status(429).json({ 
                success: false, 
                error: 'Too many requests - please wait 30 seconds before trying again' 
            });
        }

        if (error.response?.status === 400) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid request - try rephrasing your message' 
            });
        }

        res.status(500).json({ 
            success: false, 
            error: 'AI service temporarily unavailable - please try again with a simpler request' 
        });
    }
});

// Clear conversation history for a specific repository
app.post('/api/clear-conversation', async (req, res) => {
  try {
    const { repoName } = req.body;

    if (repoName && projectConversations.has(repoName)) {
      projectConversations.delete(repoName);
      saveConversations();
      console.log(`Cleared conversation history for: ${repoName}`);
    } else {
      // Clear all conversations
      projectConversations.clear();
      saveConversations();
      console.log('Cleared all conversation histories');
    }

    res.json({
      success: true,
      message: repoName ? `Cleared history for ${repoName}` : 'Cleared all conversation histories'
    });
  } catch (error) {
    console.error('Clear conversation error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GitHub - List Repositories
app.get('/api/github/repos', async (req, res) => {
  try {
    if (!octokit) {
      return res.status(400).json({ 
        success: false, 
        error: 'GitHub token not configured' 
      });
    }

    const response = await octokit.rest.repos.listForAuthenticatedUser({
      sort: 'updated',
      per_page: 50
    });

    res.json({
      success: true,
      repos: response.data.map(repo => ({
        name: repo.name,
        full_name: repo.full_name,
        description: repo.description,
        language: repo.language,
        updated_at: repo.updated_at,
        private: repo.private
      }))
    });
  } catch (error) {
    console.error('GitHub repos error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch repositories' 
    });
  }
});

// Repository Selection Endpoint
app.post('/api/repo/select', async (req, res) => {
  try {
    if (!octokit) {
      return res.status(400).json({ 
        success: false, 
        error: 'GitHub token not configured' 
      });
    }

    const { repo } = req.body;
    if (!repo || !repo.full_name) {
      return res.status(400).json({
        success: false,
        error: 'Repository information required'
      });
    }

    // Verify repository access
    const [owner, repoName] = repo.full_name.split('/');

    if (!owner || !repoName) {
      return res.status(400).json({
        success: false,
        error: 'Invalid repository format. Expected owner/repo'
      });
    }

    let repoData;
    try {
      const repoResponse = await octokit.rest.repos.get({
        owner: owner,
        repo: repoName
      });
      repoData = repoResponse.data;
    } catch (error) {
      console.error('GitHub API error:', error.message);
      if (error.status === 404) {
        return res.status(404).json({
          success: false,
          error: 'Repository not found or access denied. Check repository name and GitHub token permissions.'
        });
      }
      if (error.status === 403) {
        return res.status(403).json({
          success: false,
          error: 'Access forbidden. Check your GitHub token permissions.'
        });
      }
      return res.status(500).json({
        success: false,
        error: `GitHub API error: ${error.message}`
      });
    }

    // Create memory file for this repository
    let memoryData = { conversations: [], lastUpdated: new Date().toISOString(), totalConversations: 0 };
    let fileCreated = false;

    try {
      const memoryFile = getRepoMemoryFile(repo.full_name);

      if (await fs.pathExists(memoryFile)) {
        try {
          const existingData = await fs.readFile(memoryFile, 'utf8');
          const parsed = JSON.parse(existingData);
          if (parsed && typeof parsed === 'object') {
            memoryData = {
              conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [],
              lastUpdated: parsed.lastUpdated || new Date().toISOString(),
              totalConversations: parsed.totalConversations || 0
            };
          }
        } catch (parseError) {
          console.error('Error reading memory file:', parseError.message);
          memoryData = { conversations: [], lastUpdated: new Date().toISOString(), totalConversations: 0 };
        }
      } else {
        await fs.writeFile(memoryFile, JSON.stringify(memoryData, null, 2), 'utf8');
        fileCreated = true;
      }
    } catch (fsError) {
      console.error('File system error:', fsError.message);
    }

    res.json({
      success: true,
      message: `Connected to ${repo.full_name}`,
      repository: {
        name: repoData.name,
        full_name: repoData.full_name,
        description: repoData.description,
        private: repoData.private,
        default_branch: repoData.default_branch
      },
      memory: {
        fileCreated: fileCreated,
        totalConversations: memoryData.conversations ? memoryData.conversations.length : 0
      }
    });

  } catch (error) {
    console.error('Repository selection error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to connect to repository'
    });
  }
});

// Generate Project Files
app.post('/api/repo/generate-code', async (req, res) => {
  try {
    if (!DEEPSEEK_API_KEY) {
      return res.status(503).json({ 
        success: false, 
        error: 'AI service unavailable - API key not configured' 
      });
    }

    if (!octokit) {
      return res.status(503).json({ 
        success: false, 
        error: 'GitHub integration not available - token not configured' 
      });
    }

    const { owner, repo, instruction } = req.body;
    console.log(`Creating blueprint for: ${instruction}`);

    // Generate project blueprint
    const blueprintPrompt = `Create a complete project blueprint for: "${instruction}"

Return JSON with this structure:
{
  "action": "Building [app type] - [brief description]",
  "techStack": "chosen tech stack",
  "files": [
    {"path": "index.html", "type": "html", "description": "main landing page"},
    {"path": "style.css", "type": "css", "description": "styling"},
    {"path": "script.js", "type": "javascript", "description": "functionality"}
  ]
}

Use modern tech like Tailwind CSS, responsive design, and clean code.`;

    const blueprintResponse = await axios.post(DEEPSEEK_API_URL, {
      model: 'deepseek-coder',
      messages: [
        { role: 'system', content: 'You are a project architect. You MUST respond with only valid JSON. No explanations, no markdown formatting, no additional text. Only pure JSON.' },
        { role: 'user', content: blueprintPrompt }
      ],
      temperature: 0.1,
      max_tokens: 800
    }, {
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    let blueprint;
    try {
      const rawResponse = blueprintResponse.data.choices[0].message.content;
      const cleanResponse = rawResponse.replace(/```json|```/g, '').trim();
      const jsonMatch = cleanResponse.match(/\{[\s\S]*\}/);
      blueprint = JSON.parse(jsonMatch ? jsonMatch[0] : cleanResponse);
    } catch (e) {
      blueprint = {
        action: "Creating web application",
        techStack: "Modern HTML/CSS/JS",
        files: [
          {"path": "index.html", "type": "html", "description": "main page"},
          {"path": "style.css", "type": "css", "description": "styling"},
          {"path": "script.js", "type": "javascript", "description": "functionality"}
        ]
      };
    }

    const createdFiles = [];

    // Generate each file
    for (let i = 0; i < blueprint.files.length; i++) {
      const fileSpec = blueprint.files[i];
      console.log(`[${i + 1}/${blueprint.files.length}] Generating ${fileSpec.path}...`);

      const filePrompt = `Create a complete, modern ${fileSpec.type} file for: ${instruction}

File: ${fileSpec.path} (${fileSpec.description})
Tech Stack: ${blueprint.techStack}

REQUIREMENTS:
- If HTML: Use Tailwind CSS CDN, responsive design, modern HTML5
- If CSS: Use Tailwind utility classes, responsive design
- If JavaScript: Modern ES6+, proper error handling

Return only the code without markdown formatting.`;

      const fileResponse = await axios.post(DEEPSEEK_API_URL, {
        model: 'deepseek-coder',
        messages: [
          { role: 'system', content: `You are an expert ${fileSpec.type} developer. Generate clean code without markdown.` },
          { role: 'user', content: filePrompt }
        ],
        temperature: 0.1,
        max_tokens: 2000
      }, {
        headers: {
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      const code = fileResponse.data.choices[0].message.content
        .replace(/```[a-zA-Z]*\n/g, '').replace(/```/g, '').trim();

      // Create/update file
      let sha = null;
      try {
        const existing = await octokit.rest.repos.getContent({
          owner, repo, path: fileSpec.path
        });
        sha = existing.data.sha;
      } catch (e) {
        console.log(`Creating new file: ${fileSpec.path}`);
      }

      const upload = await octokit.rest.repos.createOrUpdateFileContents({
        owner, repo,
        path: fileSpec.path,
        message: `${blueprint.action} - ${fileSpec.description}`,
        content: Buffer.from(code).toString('base64'),
        branch: 'main',
        ...(sha && { sha })
      });

      createdFiles.push({
        path: fileSpec.path,
        action: sha ? 'updated' : 'created',
        description: fileSpec.description,
        commitSha: upload.data.commit.sha
      });

      console.log(`✓ [${i + 1}/${blueprint.files.length}] ${fileSpec.path} ${sha ? 'updated' : 'created'}`);
    }

    res.json({
      success: true,
      action: blueprint.action,
      files: createdFiles,
      message: `${blueprint.action} - ${createdFiles.length} files created`
    });

  } catch (error) {
    console.error('Blueprint generation error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.response?.data?.error || error.message || 'Failed to generate project'
    });
  }
});

// Start server with enhanced error handling for Replit
console.log(`🚀 Attempting to start server on port ${PORT}...`);

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ AI Coding Assistant running on http://0.0.0.0:${PORT}`);
  console.log(`🌍 Replit deployment ready - accessible via webview`);
  console.log('📋 Features available:');
  console.log('   - AI Code Generation' + (process.env.DEEPSEEK_API_KEY ? ' ✅' : ' ❌ (API key needed)'));
  console.log('   - GitHub Integration' + (process.env.GITHUB_TOKEN ? ' ✅' : ' ❌ (Token needed)'));
  console.log('   - Auto Error Fixing');
  console.log('   - Project Generation');
  console.log('');

  if (!process.env.GITHUB_TOKEN || !process.env.DEEPSEEK_API_KEY) {
    console.log('🔧 Setup required:');
    if (!process.env.GITHUB_TOKEN) {
      console.log('   - Add GITHUB_TOKEN to Replit Secrets');
    }
    if (!process.env.DEEPSEEK_API_KEY) {
      console.log('   - Add DEEPSEEK_API_KEY to Replit Secrets');
    }
    console.log('');
  }

  console.log('🚀 Server successfully started and ready!');
  console.log(`📱 Open the webview or visit your Repl URL to access the app`);
});

server.on('error', (err) => {
  console.error('❌ Server error occurred:', err);
```text
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use`);
  } else {
    console.error('❌ Server error:', err.message);
  }
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('📴 Gracefully shutting down server...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('📴 Gracefully shutting down server...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});