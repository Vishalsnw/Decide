const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const { Octokit } = require('@octokit/rest');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Memory storage
const MEMORY_FILE = path.join(__dirname, 'memory.json');

// Initialize GitHub client
const octokit = process.env.GITHUB_TOKEN ? new Octokit({
  auth: process.env.GITHUB_TOKEN,
}) : null;

// Memory management functions
function loadMemory() {
  try {
    if (fs.existsSync(MEMORY_FILE)) {
      return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
    }
  } catch (error) {
    console.error('Error loading memory:', error);
  }
  return {
    conversations: {},
    repositories: {},
    codeHistory: [],
    errorFixes: []
  };
}

function saveMemory(memory) {
  try {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
  } catch (error) {
    console.error('Error saving memory:', error);
  }
}

function addToMemory(sessionId, message, response, repo = null) {
  const memory = loadMemory();

  if (!memory.conversations[sessionId]) {
    memory.conversations[sessionId] = {
      messages: [],
      repository: repo,
      created: new Date().toISOString(),
      lastActive: new Date().toISOString()
    };
  }

  memory.conversations[sessionId].messages.push({
    timestamp: new Date().toISOString(),
    user: message,
    ai: response
  });

  memory.conversations[sessionId].lastActive = new Date().toISOString();

  saveMemory(memory);
  return memory.conversations[sessionId];
}

function getMemoryContext(sessionId) {
  const memory = loadMemory();
  const conversation = memory.conversations[sessionId];

  if (!conversation) return null;

  const recentMessages = conversation.messages.slice(-5);
  return {
    totalConversations: Object.keys(memory.conversations).length,
    currentSession: sessionId,
    recentMessages: recentMessages,
    repository: conversation.repository
  };
}

// Basic middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Force JSON for API routes
app.use('/api', (req, res, next) => {
  res.setHeader('Content-Type', 'application/json');
  next();
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'Server is running',
    timestamp: new Date().toISOString(),
    port: PORT,
    github: !!process.env.GITHUB_TOKEN,
    deepseek: !!process.env.DEEPSEEK_API_KEY
  });
});

// Chat endpoint with DeepSeek integration and memory
app.post('/api/chat', async (req, res) => {
  try {
    const { message, selectedRepo, sessionId = 'default' } = req.body;
    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'Message is required'
      });
    }

    // Get memory context for better AI responses
    const memoryContext = getMemoryContext(sessionId);
    let contextualPrompt = message;

    if (memoryContext && memoryContext.recentMessages.length > 0) {
      const recentContext = memoryContext.recentMessages.slice(-2)
        .map(msg => `User: ${msg.user}\nAI: ${msg.ai}`)
        .join('\n\n');
      contextualPrompt = `Previous conversation context:\n${recentContext}\n\nCurrent message: ${message}`;
    }

    // If DeepSeek API key is available, use it
    if (process.env.DEEPSEEK_API_KEY) {
      try {
        const response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
          model: 'deepseek-chat',
          messages: [
            {
              role: 'system',
              content: `You are an AI coding assistant. You have memory of previous conversations and can reference them. Help with programming questions, code generation, and debugging. ${selectedRepo ? `Currently working with repository: ${selectedRepo.full_name}` : ''}`
            },
            {
              role: 'user',
              content: contextualPrompt
            }
          ],
          max_tokens: 1000,
          temperature: 0.7
        }, {
          headers: {
            'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
            'Content-Type': 'application/json'
          }
        });

        const aiResponse = response.data.choices[0].message.content;

        // Save to memory
        const conversationContext = addToMemory(sessionId, message, aiResponse, selectedRepo);

        res.json({
          success: true,
          response: aiResponse,
          timestamp: new Date().toISOString(),
          source: 'deepseek',
          memoryContext: {
            totalConversations: conversationContext.messages.length,
            sessionId: sessionId,
            repository: selectedRepo
          }
        });
      } catch (aiError) {
        console.error('DeepSeek API error:', aiError.response?.data || aiError.message);
        const fallbackResponse = `I'm having trouble connecting to the AI service right now. Here's what I can help with based on your message: "${message}"\n\nPlease try again or rephrase your question.`;

        // Still save to memory even with fallback
        addToMemory(sessionId, message, fallbackResponse, selectedRepo);

        res.json({
          success: true,
          response: fallbackResponse,
          timestamp: new Date().toISOString(),
          source: 'fallback'
        });
      }
    } else {
      // Fallback response without API key
      const fallbackResponse = `I received your message: "${message}"\n\nTo enable full AI features, please add your DEEPSEEK_API_KEY to the environment variables.`;

      // Save to memory
      addToMemory(sessionId, message, fallbackResponse, selectedRepo);

      res.json({
        success: true,
        response: fallbackResponse,
        timestamp: new Date().toISOString(),
        source: 'fallback'
      });
    }
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({
      success: false,
      error: 'Chat service temporarily unavailable'
    });
  }
});

// GitHub repos endpoint
app.get('/api/github/repos', async (req, res) => {
  try {
    if (!octokit) {
      return res.json({
        success: true,
        repos: [],
        message: 'GitHub integration requires GITHUB_TOKEN to be configured'
      });
    }

    const { data: repos } = await octokit.rest.repos.listForAuthenticatedUser({
      sort: 'updated',
      per_page: 20
    });

    const formattedRepos = repos.map(repo => ({
      id: repo.id,
      name: repo.name,
      full_name: repo.full_name,
      description: repo.description,
      private: repo.private,
      html_url: repo.html_url,
      updated_at: repo.updated_at,
      language: repo.language,
      stars: repo.stargazers_count
    }));

    res.json({
      success: true,
      repos: formattedRepos,
      count: formattedRepos.length
    });
  } catch (error) {
    console.error('GitHub API error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch repositories',
      message: error.message
    });
  }
});

// Repository selection endpoint
app.post('/api/repo/select', (req, res) => {
  const { repo } = req.body;

  if (!repo || !repo.full_name) {
    return res.status(400).json({
      success: false,
      error: 'Repository information is required'
    });
  }

  res.json({
    success: true,
    message: `Selected repository: ${repo.full_name}`,
    repository: repo,
    memory: {
      totalConversations: 0,
      repoName: repo.full_name,
      sessionId: 'web-session'
    }
  });
});

// Code generation endpoint
app.post('/api/generate-code', async (req, res) => {
  try {
    const { prompt, language = 'javascript' } = req.body;

    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: 'Prompt is required'
      });
    }

    if (process.env.DEEPSEEK_API_KEY) {
      try {
        const response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
          model: 'deepseek-coder',
          messages: [
            {
              role: 'system',
              content: `You are a code generation assistant. Generate clean, well-documented ${language} code based on the user's request. Only return the code without explanations.`
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          max_tokens: 2000,
          temperature: 0.3
        }, {
          headers: {
            'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
            'Content-Type': 'application/json'
          }
        });

        const generatedCode = response.data.choices[0].message.content;

        res.json({
          success: true,
          code: generatedCode,
          language: language,
          timestamp: new Date().toISOString()
        });
      } catch (aiError) {
        console.error('DeepSeek API error:', aiError.response?.data || aiError.message);
        res.status(500).json({
          success: false,
          error: 'Code generation service temporarily unavailable'
        });
      }
    } else {
      res.json({
        success: false,
        error: 'Code generation requires DEEPSEEK_API_KEY to be configured'
      });
    }
  } catch (error) {
    console.error('Code generation error:', error);
    res.status(500).json({
      success: false,
      error: 'Code generation failed'
    });
  }
});

// Generate code endpoint for repo
app.post('/api/repo/generate-code', async (req, res) => {
  try {
    const { prompt, language = 'javascript' } = req.body;

    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: 'Prompt is required'
      });
    }

    if (process.env.DEEPSEEK_API_KEY) {
      try {
        const response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
          model: 'deepseek-coder',
          messages: [
            {
              role: 'system',
              content: `You are an expert ${language} developer. Generate clean, efficient, and well-commented code based on the user's requirements. Focus on best practices and maintainability.`
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          max_tokens: 2000,
          temperature: 0.7
        }, {
          headers: {
            'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
            'Content-Type': 'application/json'
          }
        });

        const generatedCode = response.data.choices[0].message.content;

        res.json({
          success: true,
          code: generatedCode,
          language: language,
          timestamp: new Date().toISOString()
        });
      } catch (aiError) {
        console.error('DeepSeek API error:', aiError.response?.data || aiError.message);
        res.status(500).json({
          success: false,
          error: 'Code generation service temporarily unavailable'
        });
      }
    } else {
      res.json({
        success: false,
        error: 'Code generation requires DEEPSEEK_API_KEY to be configured'
      });
    }
  } catch (error) {
    console.error('Repo code generation error:', error);
    res.status(500).json({
      success: false,
      error: 'Code generation failed'
    });
  }
});

// Fix and commit endpoint with actual file application
app.post('/api/fix-and-commit', async (req, res) => {
  try {
    const { error, description, action = 'analyze', filePath, sessionId = 'default' } = req.body;

    if (!error) {
      return res.status(400).json({
        success: false,
        error: 'Error description is required'
      });
    }

    if (process.env.DEEPSEEK_API_KEY) {
      try {
        let systemPrompt = '';
        let userPrompt = '';

        if (action === 'fix_and_apply') {
          systemPrompt = `You are a code fixing assistant. Analyze the error and provide the EXACT fixed code that should replace the problematic code. Format your response as:

PROBLEM: [Brief description of the issue]
SOLUTION: [Step-by-step fix]
FIXED_CODE: [The exact corrected code]
FILE_PATH: [The file path that needs to be fixed]

Be specific and provide working code that fixes the issue. Include the complete file content with the fix applied.`;

          userPrompt = `Fix this error and provide the corrected code: ${error}\n\nContext: ${description || 'No additional context'}\n\nFile path: ${filePath || 'Not specified'}\n\nI need the actual fixed code that I can apply to my files.`;
        } else {
          systemPrompt = 'You are a code debugging assistant. Analyze the error and provide a clear fix with explanation. Focus on the root cause and provide actionable solutions.';
          userPrompt = `I'm getting this error: ${error}\n\nAdditional context: ${description || 'No additional context provided'}\n\nPlease help me fix this issue.`;
        }

        const response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
          model: 'deepseek-coder',
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content: userPrompt
            }
          ],
          max_tokens: 2000,
          temperature: 0.3
        }, {
          headers: {
            'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
            'Content-Type': 'application/json'
          }
        });

        const solution = response.data.choices[0].message.content;

        // Save error fix to memory
        const memory = loadMemory();
        memory.errorFixes.push({
          timestamp: new Date().toISOString(),
          error: error,
          solution: solution,
          action: action,
          filePath: filePath,
          sessionId: sessionId
        });
        saveMemory(memory);

        // Enhanced file application for auto-fixes
        let fixedCode = null;
        let filesChanged = [];
        let applied = false;

        if (action === 'auto_fix' || action === 'fix_and_apply') {
          // Parse the FILES_TO_MODIFY format
          const filesPattern = /FILES_TO_MODIFY:\s*([\s\S]*?)(?=\n\n|$)/;
          const filesMatch = solution.match(filesPattern);

          if (filesMatch) {
            const filesSection = filesMatch[1];
            const fileMatches = filesSection.match(/- FILE: ([^\n]+)\s+CONTENT: ([\s\S]*?)(?=- FILE:|$)/g);

            if (fileMatches) {
              for (const fileMatch of fileMatches) {
                const [, filePath, content] = fileMatch.match(/- FILE: ([^\n]+)\s+CONTENT: ([\s\S]*?)$/);

                if (filePath && content) {
                  try {
                    const cleanPath = filePath.trim();
                    const cleanContent = content.trim();
                    const fullPath = path.join(__dirname, cleanPath);
                    const directory = path.dirname(fullPath);

                    // Create directory if it doesn't exist
                    if (!fs.existsSync(directory)) {
                      fs.mkdirSync(directory, { recursive: true });
                    }

                    // Write the file
                    fs.writeFileSync(fullPath, cleanContent);
                    filesChanged.push(cleanPath);
                    applied = true;
                  } catch (fileError) {
                    console.error(`Error applying fix to ${filePath}:`, fileError);
                  }
                }
              }
            }
          }

          // Enhanced fallback: try multiple code block extraction methods
          if (!applied && solution.includes('```')) {
            const codeBlocks = solution.match(/```[\s\S]*?```/g);
            if (codeBlocks && codeBlocks.length > 0) {
              for (let i = 0; i < codeBlocks.length; i++) {
                let code = codeBlocks[i].replace(/```[\w]*\n?/g, '').replace(/```/g, '').trim();

                // Smart file detection based on error context and code content
                let targetFile = filePath;
                if (!targetFile) {
                  if (error.toLowerCase().includes('vercel') && code.includes('{')) {
                    targetFile = 'vercel.json';
                  } else if (code.includes('app.listen') || code.includes('express')) {
                    targetFile = 'server.js';
                  } else if (code.includes('<!DOCTYPE html') || code.includes('<html')) {
                    targetFile = 'public/index.html';
                  } else if (code.includes('#!/usr/bin/env node') || solution.includes('CLI')) {
                    targetFile = 'cli.js';
                  } else if (code.includes('body {') || code.includes('.container {')) {
                    targetFile = 'public/style.css';
                  } else if (code.includes('"scripts"') || code.includes('"dependencies"')) {
                    targetFile = 'package.json';
                  } else if (code.includes('module.exports') || code.includes('function')) {
                    targetFile = `fix${i > 0 ? i : ''}.js`;
                  }
                }

                if (targetFile && code) {
                  try {
                    const fullPath = path.join(__dirname, targetFile);
                    const directory = path.dirname(fullPath);

                    if (!fs.existsSync(directory)) {
                      fs.mkdirSync(directory, { recursive: true });
                    }

                    fs.writeFileSync(fullPath, code);
                    filesChanged.push(targetFile);
                    applied = true;
                    fixedCode = code;
                  } catch (fileError) {
                    console.error('Error applying auto-extracted fix:', fileError);
                  }
                }
              }
            }
          }

          // Enhanced JSON config fix for vercel.json and other JSON files
          if (!applied && (error.toLowerCase().includes('json') || error.toLowerCase().includes('vercel') || error.toLowerCase().includes('parse'))) {
            // Try to extract and fix JSON from the solution
            const jsonPatterns = [
              /```json\s*([\s\S]*?)\s*```/,
              /```\s*([\s\S]*?)\s*```/,
              /\{[\s\S]*?\}/
            ];

            for (const pattern of jsonPatterns) {
              const jsonMatch = solution.match(pattern);
              if (jsonMatch) {
                try {
                  let jsonContent = jsonMatch[1] || jsonMatch[0];
                  
                  // Clean up common JSON issues
                  jsonContent = jsonContent
                    .replace(/,\s*}/g, '}')  // Remove trailing commas before }
                    .replace(/,\s*]/g, ']')  // Remove trailing commas before ]
                    .replace(/\/\/.*$/gm, '') // Remove single-line comments
                    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove multi-line comments
                    .trim();

                  // Validate JSON
                  JSON.parse(jsonContent);
                  
                  let jsonFile = 'vercel.json';
                  if (error.toLowerCase().includes('package')) {
                    jsonFile = 'package.json';
                  } else if (error.toLowerCase().includes('tsconfig')) {
                    jsonFile = 'tsconfig.json';
                  }

                  const fullPath = path.join(__dirname, jsonFile);
                  fs.writeFileSync(fullPath, JSON.stringify(JSON.parse(jsonContent), null, 2));
                  filesChanged.push(jsonFile);
                  applied = true;
                  fixedCode = jsonContent;
                  break;
                } catch (jsonError) {
                  console.error('Invalid JSON pattern:', jsonError);
                  // Continue to next pattern
                }
              }
            }
          }
        }

        res.json({
          success: true,
          solution: solution,
          fixedCode: fixedCode,
          filesChanged: filesChanged,
          applied: applied,
          action: action,
          timestamp: new Date().toISOString(),
          error_analyzed: error
        });
      } catch (aiError) {
        console.error('DeepSeek API error:', aiError.response?.data || aiError.message);
        res.status(500).json({
          success: false,
          error: 'Fix analysis service temporarily unavailable'
        });
      }
    } else {
      res.json({
        success: false,
        error: 'Error fixing requires DEEPSEEK_API_KEY to be configured'
      });
    }
  } catch (error) {
    console.error('Fix and commit error:', error);
    res.status(500).json({
      success: false,
      error: 'Error analysis failed'
    });
  }
});

// Memory endpoint
app.get('/api/memory', (req, res) => {
  try {
    const { sessionId } = req.query;
    const memory = loadMemory();

    if (sessionId) {
      const conversation = memory.conversations[sessionId];
      res.json({
        success: true,
        conversation: conversation,
        totalConversations: Object.keys(memory.conversations).length
      });
    } else {
      res.json({
        success: true,
        totalConversations: Object.keys(memory.conversations).length,
        totalErrorFixes: memory.errorFixes.length,
        totalCodeHistory: memory.codeHistory.length
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to load memory'
    });
  }
});

// Clear conversation endpoint
app.post('/api/clear-conversation', (req, res) => {
  try {
    const { sessionId } = req.body;
    const memory = loadMemory();

    if (sessionId && memory.conversations[sessionId]) {
      delete memory.conversations[sessionId];
      saveMemory(memory);
      res.json({
        success: true,
        message: 'Conversation cleared'
      });
    } else if (!sessionId) {
      // Clear all conversations
      memory.conversations = {};
      saveMemory(memory);
      res.json({
        success: true,
        message: 'All conversations cleared'
      });
    } else {
      res.json({
        success: false,
        error: 'Conversation not found'
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to clear conversation'
    });
  }
});

// Create React Native app endpoint
app.post('/api/create-react-native', async (req, res) => {
  try {
    const { domain, sessionId = 'default' } = req.body;

    if (!domain) {
      return res.status(400).json({
        success: false,
        error: 'Domain is required'
      });
    }

    const ReactNativeBuilder = require('./react-native-builder');
    const builder = new ReactNativeBuilder(domain);

    console.log(`🚀 Starting React Native app creation for domain: ${domain}`);

    // Create the project
    const result = await builder.createProject();

    // Save to memory
    const memory = loadMemory();
    memory.codeHistory.push({
      timestamp: new Date().toISOString(),
      type: 'react_native_creation',
      domain: domain,
      projectPath: result.projectPath,
      builds: result.builds,
      sessionId: sessionId
    });
    saveMemory(memory);

    res.json({
      success: true,
      message: `React Native app created successfully for ${domain}`,
      domain: domain,
      projectPath: result.projectPath,
      builds: result.builds,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('React Native creation error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'React Native app creation failed'
    });
  }
});

// Create webapp endpoint for automatic app generation
app.post('/api/create-webapp', async (req, res) => {
  try {
    const { idea, description, sessionId = 'default' } = req.body;

    if (!idea) {
      return res.status(400).json({
        success: false,
        error: 'App idea is required'
      });
    }

    if (process.env.DEEPSEEK_API_KEY) {
      try {
        const response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
          model: 'deepseek-coder',
          messages: [
            {
              role: 'system',
              content: `You are an expert web app generator. Create complete, functional, mobile-responsive web applications based on user ideas. Always provide:

1. Complete HTML file with embedded CSS and JavaScript
2. Modern, clean, responsive design
3. Full functionality as requested
4. Dark theme with good UX

Format your response as:
SOLUTION: [Brief description of what you created]

FILES_TO_MODIFY:
- FILE: public/index.html
  CONTENT: [Complete HTML file with embedded styles and scripts]

Make the app fully functional and production-ready.`
            },
            {
              role: 'user',
              content: `Create a complete web application for: ${idea}\n\nAdditional details: ${description}\n\nMake it mobile-responsive, modern, and fully functional.`
            }
          ],
          max_tokens: 4000,
          temperature: 0.7
        }, {
          headers: {
            'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
            'Content-Type': 'application/json'
          }
        });

        const solution = response.data.choices[0].message.content;

        // Parse and apply files
        const filesPattern = /FILES_TO_MODIFY:\s*([\s\S]*?)(?=\n\n|$)/;
        const filesMatch = solution.match(filesPattern);
        let filesCreated = [];
        let created = false;

        if (filesMatch) {
          const filesSection = filesMatch[1];
          const fileMatches = filesSection.match(/- FILE: ([^\n]+)\s+CONTENT: ([\s\S]*?)(?=- FILE:|$)/g);

          if (fileMatches) {
            for (const fileMatch of fileMatches) {
              const [, filePath, content] = fileMatch.match(/- FILE: ([^\n]+)\s+CONTENT: ([\s\S]*?)$/);

              if (filePath && content) {
                try {
                  const cleanPath = filePath.trim();
                  const cleanContent = content.trim();
                  const fullPath = path.join(__dirname, cleanPath);
                  const directory = path.dirname(fullPath);

                  // Create directory if it doesn't exist
                  if (!fs.existsSync(directory)) {
                    fs.mkdirSync(directory, { recursive: true });
                  }

                  // Write the file
                  fs.writeFileSync(fullPath, cleanContent);
                  filesCreated.push(cleanPath);
                  created = true;
                } catch (fileError) {
                  console.error(`Error creating file ${filePath}:`, fileError);
                }
              }
            }
          }
        }

        // Save to memory
        const memory = loadMemory();
        memory.codeHistory.push({
          timestamp: new Date().toISOString(),
          type: 'webapp_creation',
          idea: idea,
          solution: solution,
          filesCreated: filesCreated,
          sessionId: sessionId
        });
        saveMemory(memory);

        res.json({
          success: true,
          solution: solution,
          created: created,
          filesCreated: filesCreated,
          timestamp: new Date().toISOString()
        });
      } catch (aiError) {
        console.error('DeepSeek API error:', aiError.response?.data || aiError.message);
        res.status(500).json({
          success: false,
          error: 'Web app creation service temporarily unavailable'
        });
      }
    } else {
      res.json({
        success: false,
        error: 'Web app creation requires DEEPSEEK_API_KEY to be configured'
      });
    }
  } catch (error) {
    console.error('Create webapp error:', error);
    res.status(500).json({
      success: false,
      error: 'Web app creation failed'
    });
  }
});

// Default route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Catch-all for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    error: `API endpoint not found: ${req.originalUrl}`
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err.message);
  if (req.path.startsWith('/api/')) {
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  } else {
    res.status(500).send('Internal server error');
  }
});

// Start server
console.log(`🚀 Starting AI Coding Assistant on port ${PORT}...`);
console.log(`🔑 GitHub Token: ${process.env.GITHUB_TOKEN ? '✅ Configured' : '❌ Missing'}`);
console.log(`🤖 DeepSeek API: ${process.env.DEEPSEEK_API_KEY ? '✅ Configured' : '❌ Missing'}`);

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on http://0.0.0.0:${PORT}`);
  console.log(`🌍 Replit deployment ready`);
  console.log(`📱 Open webview to access the app`);
});

server.on('error', (err) => {
  console.error('❌ Server error:', err.message);
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('📴 Shutting down...');
  server.close(() => {
    process.exit(0);
  });
});