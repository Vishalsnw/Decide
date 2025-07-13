
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { Octokit } = require('@octokit/rest');
const simpleGit = require('simple-git');
const fs = require('fs-extra');
const { exec } = require('child_process');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Initialize GitHub client
const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN
});

// DeepSeek API configuration
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

// AI Code Generation
app.post('/api/generate-code', async (req, res) => {
  try {
    const { prompt, language, context } = req.body;
    
    const systemPrompt = `You are an expert ${language} programmer. Generate clean, well-commented, production-ready code based on the user's request. Include proper error handling and follow best practices.`;
    
    const response = await axios.post(DEEPSEEK_API_URL, {
      model: 'deepseek-coder',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `${context ? 'Context: ' + context + '\n\n' : ''}Request: ${prompt}` }
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
    
    res.json({
      success: true,
      code: generatedCode,
      language: language
    });
  } catch (error) {
    console.error('Code generation error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test Code Generation
app.post('/api/generate-tests', async (req, res) => {
  try {
    const { code, language, testFramework } = req.body;
    
    const testPrompt = `Generate comprehensive unit tests for the following ${language} code using ${testFramework}. Include edge cases, error scenarios, and positive test cases:\n\n${code}`;
    
    const response = await axios.post(DEEPSEEK_API_URL, {
      model: 'deepseek-coder',
      messages: [
        { role: 'system', content: `You are an expert in writing ${testFramework} tests for ${language}. Generate thorough, well-structured tests.` },
        { role: 'user', content: testPrompt }
      ],
      temperature: 0.1,
      max_tokens: 1500
    }, {
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const testCode = response.data.choices[0].message.content;
    
    res.json({
      success: true,
      tests: testCode,
      framework: testFramework
    });
  } catch (error) {
    console.error('Test generation error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Debug Code
app.post('/api/debug-code', async (req, res) => {
  try {
    const { code, error, language } = req.body;
    
    const debugPrompt = `Debug this ${language} code that has the following error: "${error}"\n\nCode:\n${code}\n\nProvide:\n1. Explanation of the issue\n2. Fixed code\n3. Prevention tips`;
    
    const response = await axios.post(DEEPSEEK_API_URL, {
      model: 'deepseek-coder',
      messages: [
        { role: 'system', content: `You are an expert debugger. Analyze code issues and provide clear fixes with explanations.` },
        { role: 'user', content: debugPrompt }
      ],
      temperature: 0.1,
      max_tokens: 1500
    }, {
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const debugResponse = response.data.choices[0].message.content;
    
    res.json({
      success: true,
      debug: debugResponse
    });
  } catch (error) {
    console.error('Debug error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Store conversation history per session
const conversationHistory = new Map();

// Chat with AI (Repository-aware)
app.post('/api/chat', async (req, res) => {
  try {
    const { message, selectedRepo, sessionId = 'default' } = req.body;
    
    // Get or create conversation history for this session
    if (!conversationHistory.has(sessionId)) {
      conversationHistory.set(sessionId, []);
    }
    const history = conversationHistory.get(sessionId);
    
    let systemPrompt = 'You are an expert AI coding assistant like Replit Agent. You help users build, modify, and fix code by understanding their natural language requests. Be conversational, helpful, and explain what you can do.';
    
    if (selectedRepo) {
      systemPrompt += ` You are currently connected to the repository "${selectedRepo.name}" (${selectedRepo.description || 'No description'}). You can help create new files, modify existing code, add features, fix bugs, and build complete applications. When users ask for code changes, you will automatically handle file creation and commits.`;
    } else {
      systemPrompt += ' The user hasn\'t connected a repository yet. Encourage them to import a repository from GitHub so you can help them with their code.';
    }
    
    // Build messages array with history
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-8), // Keep last 8 messages for context
      { role: 'user', content: message }
    ];
    
    const response = await axios.post(DEEPSEEK_API_URL, {
      model: 'deepseek-coder',
      messages: messages,
      temperature: 0.3,
      max_tokens: 1500
    }, {
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const aiResponse = response.data.choices[0].message.content;
    
    // Add to conversation history
    history.push({ role: 'user', content: message });
    history.push({ role: 'assistant', content: aiResponse });
    
    // Keep history manageable (last 16 messages)
    if (history.length > 16) {
      history.splice(0, history.length - 16);
    }
    
    res.json({
      success: true,
      response: aiResponse,
      sessionId: sessionId
    });
  } catch (error) {
    console.error('Chat error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Generate and commit code to repository
app.post('/api/repo/generate-code', async (req, res) => {
  try {
    const { owner, repo, instruction, language = 'javascript', fileName = 'index.html' } = req.body;
    
    // Determine appropriate file type and content based on instruction
    let finalFileName = fileName;
    let fileLanguage = language;
    
    if (instruction.toLowerCase().includes('html') || instruction.toLowerCase().includes('website') || instruction.toLowerCase().includes('page')) {
      finalFileName = 'index.html';
      fileLanguage = 'html';
    } else if (instruction.toLowerCase().includes('python')) {
      finalFileName = 'main.py';
      fileLanguage = 'python';
    } else if (instruction.toLowerCase().includes('react')) {
      finalFileName = 'App.js';
      fileLanguage = 'javascript';
    } else if (instruction.toLowerCase().includes('api') || instruction.toLowerCase().includes('server')) {
      finalFileName = 'server.js';
      fileLanguage = 'javascript';
    } else if (instruction.toLowerCase().includes('calculator') || instruction.toLowerCase().includes('app')) {
      finalFileName = 'index.html';
      fileLanguage = 'html';
    }
    
    const systemPrompt = `You are an expert ${fileLanguage} programmer. Generate complete, production-ready code based on the user's instruction. 

If creating HTML: Include HTML, CSS, and JavaScript all in one file with proper structure, styling, and functionality.
If creating Python: Write clean, well-commented Python code with proper error handling.
If creating JavaScript: Write modern ES6+ JavaScript with proper structure.

Return ONLY the complete code without any explanations, markdown formatting, or code blocks.`;
    
    const response = await axios.post(DEEPSEEK_API_URL, {
      model: 'deepseek-coder',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Create a ${fileLanguage} file for: ${instruction}. Make it fully functional, responsive, and production-ready.` }
      ],
      temperature: 0.1,
      max_tokens: 4000
    }, {
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    let generatedCode = response.data.choices[0].message.content;
    
    // Clean the code (remove any markdown formatting that might slip through)
    generatedCode = generatedCode.replace(/```[a-zA-Z]*\n/g, '').replace(/```/g, '').trim();
    
    // Check if file already exists to get SHA
    let sha = null;
    try {
      const existingFile = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: finalFileName
      });
      sha = existingFile.data.sha;
    } catch (error) {
      // File doesn't exist, that's fine
    }
    
    // Upload to GitHub
    const uploadResponse = await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: finalFileName,
      message: `${sha ? 'Update' : 'Add'} ${finalFileName} - AI generated code`,
      content: Buffer.from(generatedCode).toString('base64'),
      ...(sha && { sha })
    });
    
    console.log(`Successfully ${sha ? 'updated' : 'created'} ${finalFileName} in ${owner}/${repo}`);
    
    res.json({
      success: true,
      fileName: finalFileName,
      commitUrl: uploadResponse.data.commit.html_url,
      action: sha ? 'updated' : 'created'
    });
  } catch (error) {
    console.error('Code generation error:', error.response?.data || error.message);
    
    let errorMessage = error.message;
    if (error.response?.status === 404) {
      errorMessage = 'Repository not found or no write access';
    } else if (error.response?.status === 403) {
      errorMessage = 'Insufficient permissions to write to repository';
    } else if (error.response?.data?.message) {
      errorMessage = error.response.data.message;
    }
    
    res.status(500).json({ success: false, error: errorMessage });
  }
});

// GitHub Integration - List Repositories
app.get('/api/github/repos', async (req, res) => {
  try {
    if (!process.env.GITHUB_TOKEN) {
      return res.status(400).json({ 
        success: false, 
        error: 'GitHub token not configured. Please add your GitHub token to the environment variables.' 
      });
    }

    // Validate token format
    if (!process.env.GITHUB_TOKEN.startsWith('github_pat_') && !process.env.GITHUB_TOKEN.startsWith('ghp_')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid GitHub token format. Please use a valid Personal Access Token.'
      });
    }

    console.log('Attempting to fetch repos with token:', process.env.GITHUB_TOKEN.substring(0, 20) + '...');
    
    const { data } = await octokit.rest.repos.listForAuthenticatedUser({
      sort: 'updated',
      per_page: 50
    });
    
    console.log(`Successfully fetched ${data.length} repositories`);
    
    res.json({
      success: true,
      repos: data.map(repo => ({
        name: repo.name,
        full_name: repo.full_name,
        description: repo.description,
        language: repo.language,
        updated_at: repo.updated_at,
        clone_url: repo.clone_url,
        private: repo.private
      }))
    });
  } catch (error) {
    console.error('GitHub repos error:', error.response?.data || error.message);
    
    let errorMessage = 'Unknown GitHub API error';
    if (error.response?.status === 401) {
      errorMessage = 'GitHub token is invalid or expired. Please check your Personal Access Token.';
    } else if (error.response?.status === 403) {
      errorMessage = 'GitHub token lacks required permissions. Please ensure it has "repo" and "user" scopes.';
    } else if (error.response?.data?.message) {
      errorMessage = error.response.data.message;
    }
    
    res.status(error.response?.status || 500).json({ 
      success: false, 
      error: `GitHub API Error: ${errorMessage}` 
    });
  }
});

// Clone Repository
app.post('/api/github/clone', async (req, res) => {
  try {
    const { repoUrl, localPath } = req.body;
    const git = simpleGit();
    
    const targetPath = path.join(__dirname, 'repos', localPath);
    await fs.ensureDir(targetPath);
    
    await git.clone(repoUrl, targetPath);
    
    res.json({
      success: true,
      message: 'Repository cloned successfully',
      path: targetPath
    });
  } catch (error) {
    console.error('Clone error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Run Tests
app.post('/api/run-tests', async (req, res) => {
  try {
    const { projectPath, testCommand } = req.body;
    
    exec(testCommand, { cwd: projectPath }, (error, stdout, stderr) => {
      res.json({
        success: !error,
        output: stdout,
        error: stderr || error?.message
      });
    });
  } catch (error) {
    console.error('Test execution error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get Repository Files
app.get('/api/github/files/:owner/:repo', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const { path = '' } = req.query;
    
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path
    });
    
    res.json({
      success: true,
      files: Array.isArray(data) ? data : [data]
    });
  } catch (error) {
    console.error('Get files error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get File Content
app.get('/api/github/file/:owner/:repo/*', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const filePath = req.params[0];
    
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: filePath
    });
    
    const content = Buffer.from(data.content, 'base64').toString('utf8');
    
    res.json({
      success: true,
      content,
      sha: data.sha,
      path: filePath
    });
  } catch (error) {
    console.error('Get file content error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// AI-Powered Code Modification
app.post('/api/github/ai-modify', async (req, res) => {
  try {
    const { owner, repo, filePath, currentContent, modification, language } = req.body;
    
    const systemPrompt = `You are an expert ${language} programmer. Modify the provided code based on the user's request. Return only the modified code without explanations or markdown formatting.`;
    
    const userPrompt = `Current code:\n\`\`\`${language}\n${currentContent}\n\`\`\`\n\nModification request: ${modification}\n\nReturn the complete modified code:`;
    
    const response = await axios.post(DEEPSEEK_API_URL, {
      model: 'deepseek-coder',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1,
      max_tokens: 3000
    }, {
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const modifiedCode = response.data.choices[0].message.content;
    
    res.json({
      success: true,
      modifiedCode,
      originalCode: currentContent
    });
  } catch (error) {
    console.error('AI modification error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create/Update File in Repository
app.post('/api/github/update-file', async (req, res) => {
  try {
    const { owner, repo, path, content, message, branch = 'main' } = req.body;
    
    // Check if file exists
    let sha;
    try {
      const { data } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path,
        ref: branch
      });
      sha = data.sha;
    } catch (error) {
      // File doesn't exist, that's okay
    }
    
    const { data } = await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message,
      content: Buffer.from(content).toString('base64'),
      branch,
      ...(sha && { sha })
    });
    
    res.json({
      success: true,
      commit: data.commit
    });
  } catch (error) {
    console.error('File update error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create GitHub Repository
app.post('/api/github/create-repo', async (req, res) => {
  try {
    const { name, description, private: isPrivate = false } = req.body;
    
    const { data } = await octokit.rest.repos.createForAuthenticatedUser({
      name,
      description,
      private: isPrivate,
      auto_init: true
    });
    
    res.json({
      success: true,
      ...data
    });
  } catch (error) {
    console.error('Create repo error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Generate Project Plan
app.post('/api/generate-project-plan', async (req, res) => {
  try {
    const { idea, projectName, techStack } = req.body;
    
    const systemPrompt = `You are an expert software architect. Create a detailed project plan for building a web application. Return your response as a JSON object with the following structure:
    {
      "architecture": "description of the overall architecture",
      "files": ["list", "of", "files", "to", "create"],
      "features": ["list", "of", "key", "features"],
      "techDetails": "technical implementation details"
    }`;
    
    const userPrompt = `Create a project plan for: "${idea}"
    Project Name: ${projectName}
    Technology Stack: ${techStack}
    
    Make it production-ready with proper error handling, responsive design, and best practices.`;
    
    const response = await axios.post(DEEPSEEK_API_URL, {
      model: 'deepseek-coder',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.2,
      max_tokens: 2000
    }, {
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const planText = response.data.choices[0].message.content;
    
    res.json({
      success: true,
      plan: planText
    });
  } catch (error) {
    console.error('Project plan error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Generate Project Files
app.post('/api/generate-project-files', async (req, res) => {
  try {
    const { plan, projectName, techStack } = req.body;
    
    // Enhanced project templates based on tech stack
    const projectTemplates = {
      'html-css-js': async () => {
        const files = {};
        
        const htmlPrompt = `Create a complete, professional HTML5 website for "${projectName}". Requirements: ${plan}. Include semantic HTML, proper meta tags, accessibility features, and modern structure.`;
        const htmlResponse = await makeAIRequest(htmlPrompt, 'You are an expert frontend developer. Generate clean, semantic HTML5 code without markdown formatting.');
        files['index.html'] = cleanCode(htmlResponse, 'html');
        
        const cssPrompt = `Create modern CSS for "${projectName}". Requirements: ${plan}. Include responsive design, CSS Grid/Flexbox, modern styling, animations, and mobile-first approach.`;
        const cssResponse = await makeAIRequest(cssPrompt, 'You are an expert CSS developer. Generate clean, modern CSS without markdown formatting.');
        files['style.css'] = cleanCode(cssResponse, 'css');
        
        const jsPrompt = `Create interactive JavaScript for "${projectName}". Requirements: ${plan}. Include ES6+ features, DOM manipulation, form handling, API calls, and proper error handling.`;
        const jsResponse = await makeAIRequest(jsPrompt, 'You are an expert JavaScript developer. Generate clean, modern JavaScript without markdown formatting.');
        files['script.js'] = cleanCode(jsResponse, 'js');
        
        return files;
      },
      
      'react': async () => {
        const files = {};
        
        files['index.html'] = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${projectName}</title>
    <style>
        body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
        #root { min-height: 100vh; }
    </style>
</head>
<body>
    <div id="root"></div>
    <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
    <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
    <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
    <script type="text/babel" src="app.js"></script>
</body>
</html>`;

        const reactPrompt = `Create a complete React application for "${projectName}". Requirements: ${plan}. Include functional components, hooks (useState, useEffect), modern React patterns, and proper component structure.`;
        const reactResponse = await makeAIRequest(reactPrompt, 'You are an expert React developer. Generate clean React JSX code without markdown formatting.');
        files['app.js'] = cleanCode(reactResponse, 'js');
        
        const cssPrompt = `Create modern CSS for React app "${projectName}". Requirements: ${plan}. Include component-based styling, responsive design, and modern UI patterns.`;
        const cssResponse = await makeAIRequest(cssPrompt, 'You are an expert CSS developer. Generate clean CSS without markdown formatting.');
        files['style.css'] = cleanCode(cssResponse, 'css');
        
        files['package.json'] = JSON.stringify({
          name: projectName.toLowerCase().replace(/\s+/g, '-'),
          version: '1.0.0',
          dependencies: {
            'react': '^18.0.0',
            'react-dom': '^18.0.0'
          }
        }, null, 2);
        
        return files;
      },
      
      'node-express': async () => {
        const files = {};
        
        const serverPrompt = `Create a complete Express.js server for "${projectName}". Requirements: ${plan}. Include proper routing, middleware, error handling, API endpoints, and static file serving.`;
        const serverResponse = await makeAIRequest(serverPrompt, 'You are an expert Node.js/Express developer. Generate clean server code without markdown formatting.');
        files['app.js'] = cleanCode(serverResponse, 'js');
        
        files['package.json'] = JSON.stringify({
          name: projectName.toLowerCase().replace(/\s+/g, '-'),
          version: '1.0.0',
          main: 'app.js',
          scripts: {
            start: 'node app.js',
            dev: 'nodemon app.js'
          },
          dependencies: {
            express: '^4.18.2',
            cors: '^2.8.5',
            dotenv: '^16.3.1'
          },
          devDependencies: {
            nodemon: '^3.0.1'
          }
        }, null, 2);
        
        const htmlPrompt = `Create an HTML frontend for Express app "${projectName}". Requirements: ${plan}. Include AJAX calls to backend APIs and modern UI.`;
        const htmlResponse = await makeAIRequest(htmlPrompt, 'You are an expert frontend developer. Generate clean HTML without markdown formatting.');
        files['public/index.html'] = cleanCode(htmlResponse, 'html');
        
        return files;
      },
      
      'python-flask': async () => {
        const files = {};
        
        const flaskPrompt = `Create a complete Flask application for "${projectName}". Requirements: ${plan}. Include proper routing, templates, API endpoints, error handling, and Flask best practices.`;
        const flaskResponse = await makeAIRequest(flaskPrompt, 'You are an expert Python Flask developer. Generate clean Flask code without markdown formatting.');
        files['app.py'] = cleanCode(flaskResponse, 'python');
        
        const htmlPrompt = `Create an HTML template for Flask app "${projectName}". Requirements: ${plan}. Use Jinja2 templating and modern frontend practices.`;
        const htmlResponse = await makeAIRequest(htmlPrompt, 'You are an expert web developer. Generate clean HTML with Jinja2 templates without markdown formatting.');
        files['templates/index.html'] = cleanCode(htmlResponse, 'html');
        
        files['requirements.txt'] = `Flask==2.3.3
python-dotenv==1.0.0
gunicorn==21.2.0`;
        
        return files;
      }
    };
    
    // Helper function to make AI requests
    async function makeAIRequest(prompt, systemMessage) {
      const response = await axios.post(DEEPSEEK_API_URL, {
        model: 'deepseek-coder',
        messages: [
          { role: 'system', content: systemMessage },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 3000
      }, {
        headers: {
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });
      return response.data.choices[0].message.content;
    }
    
    // Helper function to clean code
    function cleanCode(code, type) {
      const patterns = {
        'html': /```html|```/g,
        'css': /```css|```/g,
        'js': /```javascript|```js|```/g,
        'python': /```python|```py|```/g
      };
      return code.replace(patterns[type] || /```/g, '').trim();
    }
    
    // Generate files based on tech stack
    const generator = projectTemplates[techStack] || projectTemplates['html-css-js'];
    const files = await generator();
    
    // Add common files
    files['README.md'] = `# ${projectName}

AI-generated application built with ${techStack}.

## Description
${plan}

## Features
- Modern, responsive design
- Clean, maintainable code
- Best practices implementation
- Ready for development and deployment

## Quick Start

${techStack === 'python-flask' ? 
  '1. Install dependencies: `pip install -r requirements.txt`\n2. Run: `python app.py`\n3. Open: http://localhost:5000' :
  techStack === 'node-express' ?
  '1. Install dependencies: `npm install`\n2. Run: `npm start`\n3. Open: http://localhost:3000' :
  '1. Open `index.html` in your browser\n2. Start developing!'
}

## Tech Stack
- ${techStack.split('-').map(tech => tech.charAt(0).toUpperCase() + tech.slice(1)).join(' + ')}

## Project Structure
${Object.keys(files).map(file => `- \`${file}\``).join('\n')}

---
Generated with AI Code Studio
`;
    
    res.json({
      success: true,
      files: files
    });
  } catch (error) {
    console.error('File generation error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test Project
app.post('/api/test-project', async (req, res) => {
  try {
    const { files, techStack } = req.body;
    
    // Simulate testing by checking for common issues
    const issues = [];
    
    // Check for HTML structure
    if (files['index.html']) {
      const html = files['index.html'];
      if (!html.includes('<!DOCTYPE html>')) {
        issues.push('Missing DOCTYPE declaration');
      }
      if (!html.includes('<title>')) {
        issues.push('Missing page title');
      }
    }
    
    // Check for CSS
    if (!files['style.css'] && !files['styles.css']) {
      issues.push('No CSS file found');
    }
    
    res.json({
      success: true,
      issues: issues,
      status: issues.length === 0 ? 'passed' : 'issues_found'
    });
  } catch (error) {
    console.error('Project test error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Fix Project Issues
app.post('/api/fix-project-issues', async (req, res) => {
  try {
    const { files, issues, techStack } = req.body;
    
    const systemPrompt = `You are an expert developer. Fix the identified issues in the provided files. Return the corrected files as a JSON object with the same structure.`;
    
    const userPrompt = `Fix these issues in the project files:
    Issues: ${issues.join(', ')}
    
    Current Files:
    ${JSON.stringify(files, null, 2)}
    
    Return the corrected files as JSON.`;
    
    const response = await axios.post(DEEPSEEK_API_URL, {
      model: 'deepseek-coder',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1,
      max_tokens: 3000
    }, {
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const fixedFilesText = response.data.choices[0].message.content;
    
    let fixedFiles;
    try {
      fixedFiles = JSON.parse(fixedFilesText);
    } catch (e) {
      fixedFiles = files; // Return original if parsing fails
    }
    
    res.json({
      success: true,
      files: fixedFiles
    });
  } catch (error) {
    console.error('Fix issues error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// For Vercel deployment
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AI Coding Assistant running on http://0.0.0.0:${PORT}`);
  });
}

module.exports = app;
