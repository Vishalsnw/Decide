
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

// Chat with AI (Repository-aware)
app.post('/api/chat', async (req, res) => {
  try {
    const { message, selectedRepo, repoFiles } = req.body;
    
    let systemPrompt = 'You are an expert AI coding assistant specialized in repository management and code generation.';
    
    if (selectedRepo) {
      systemPrompt += ` You are currently working on the repository "${selectedRepo.name}". You can create, modify, or analyze files in this repository. When the user asks for code changes, provide specific file names and complete code content.`;
    }
    
    let contextMessage = message;
    if (repoFiles && repoFiles.length > 0) {
      contextMessage += `\n\nCurrent repository files: ${repoFiles.join(', ')}`;
    }
    
    const response = await axios.post(DEEPSEEK_API_URL, {
      model: 'deepseek-coder',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: contextMessage }
      ],
      temperature: 0.3,
      max_tokens: 2000
    }, {
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const aiResponse = response.data.choices[0].message.content;
    
    res.json({
      success: true,
      response: aiResponse,
      hasCodeAction: message.toLowerCase().includes('add') || message.toLowerCase().includes('create') || message.toLowerCase().includes('modify')
    });
  } catch (error) {
    console.error('Chat error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Generate and commit code to repository
app.post('/api/repo/generate-code', async (req, res) => {
  try {
    const { owner, repo, instruction, language, fileName } = req.body;
    
    const systemPrompt = `You are an expert ${language} programmer. Generate complete, production-ready code based on the user's instruction. Return only the code without explanations or markdown formatting.`;
    
    const response = await axios.post(DEEPSEEK_API_URL, {
      model: 'deepseek-coder',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: instruction }
      ],
      temperature: 0.1,
      max_tokens: 3000
    }, {
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const generatedCode = response.data.choices[0].message.content;
    
    // Upload to GitHub
    const uploadResponse = await octokit.rest.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: fileName,
      message: `Add ${fileName} - AI generated code`,
      content: Buffer.from(generatedCode).toString('base64')
    });
    
    res.json({
      success: true,
      code: generatedCode,
      fileName: fileName,
      commitUrl: uploadResponse.data.commit.html_url
    });
  } catch (error) {
    console.error('Code generation error:', error.message);
    res.status(500).json({ success: false, error: error.message });
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
    
    const systemPrompt = `You are an expert full-stack developer. Generate complete, production-ready files for a web application based on the provided plan. 

    IMPORTANT: Return your response as a JSON object where each key is a file path and each value is the complete file content. Format:
    {
      "index.html": "<!DOCTYPE html>...",
      "style.css": "/* CSS content */...",
      "script.js": "// JavaScript content...",
      "README.md": "# Project documentation..."
    }
    
    Include ALL necessary files for a working application.`;
    
    const userPrompt = `Generate complete files for this project:
    Plan: ${plan}
    Project Name: ${projectName}
    Tech Stack: ${techStack}
    
    Create a fully functional web application with:
    - Responsive HTML structure
    - Professional CSS styling
    - Complete JavaScript functionality
    - README with setup instructions
    - Any necessary configuration files
    
    Make it production-ready and visually appealing.`;
    
    const response = await axios.post(DEEPSEEK_API_URL, {
      model: 'deepseek-coder',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1,
      max_tokens: 4000
    }, {
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const filesText = response.data.choices[0].message.content;
    
    // Try to parse as JSON, if fails, create a simple structure
    let files;
    try {
      files = JSON.parse(filesText);
    } catch (e) {
      // Fallback: create basic files structure
      files = {
        'index.html': filesText,
        'README.md': `# ${projectName}\n\nAI-generated web application.\n\n## Setup\n1. Open index.html in a browser\n2. Enjoy your app!`
      };
    }
    
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
