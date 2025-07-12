
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

// Chat with AI
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    
    const response = await axios.post(DEEPSEEK_API_URL, {
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: 'You are a helpful AI coding assistant. Help users with programming questions, code explanations, and development guidance.' },
        { role: 'user', content: message }
      ],
      temperature: 0.7,
      max_tokens: 1500
    }, {
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const aiResponse = response.data.choices[0].message.content;
    
    res.json({
      success: true,
      response: aiResponse
    });
  } catch (error) {
    console.error('Chat error:', error.message);
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

    const { data } = await octokit.rest.repos.listForAuthenticatedUser({
      sort: 'updated',
      per_page: 50
    });
    
    res.json({
      success: true,
      repos: data.map(repo => ({
        name: repo.name,
        full_name: repo.full_name,
        description: repo.description,
        language: repo.language,
        updated_at: repo.updated_at,
        clone_url: repo.clone_url
      }))
    });
  } catch (error) {
    console.error('GitHub repos error:', error.response?.data || error.message);
    res.status(500).json({ 
      success: false, 
      error: `GitHub API Error: ${error.response?.data?.message || error.message}. Please check your GitHub token.` 
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

// For Vercel deployment
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AI Coding Assistant running on http://0.0.0.0:${PORT}`);
  });
}

module.exports = app;
