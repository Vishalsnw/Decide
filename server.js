
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const { Octokit } = require('@octokit/rest');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Initialize GitHub client
const octokit = process.env.GITHUB_TOKEN ? new Octokit({
  auth: process.env.GITHUB_TOKEN,
}) : null;

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

// Chat endpoint with DeepSeek integration
app.post('/api/chat', async (req, res) => {
  try {
    const { message, selectedRepo } = req.body;
    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'Message is required'
      });
    }

    // If DeepSeek API key is available, use it
    if (process.env.DEEPSEEK_API_KEY) {
      try {
        const response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
          model: 'deepseek-chat',
          messages: [
            {
              role: 'system',
              content: 'You are an AI coding assistant. Help with programming questions and code generation.'
            },
            {
              role: 'user',
              content: message
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
        
        res.json({
          success: true,
          response: aiResponse,
          timestamp: new Date().toISOString(),
          source: 'deepseek'
        });
      } catch (aiError) {
        console.error('DeepSeek API error:', aiError.response?.data || aiError.message);
        res.json({
          success: true,
          response: `I'm having trouble connecting to the AI service right now. Here's what I can help with based on your message: "${message}"\n\nPlease try again or rephrase your question.`,
          timestamp: new Date().toISOString(),
          source: 'fallback'
        });
      }
    } else {
      // Fallback response without API key
      res.json({
        success: true,
        response: `I received your message: "${message}"\n\nTo enable full AI features, please add your DEEPSEEK_API_KEY to the environment variables.`,
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

// Fix and commit endpoint
app.post('/api/fix-and-commit', async (req, res) => {
  try {
    const { error, description, action = 'analyze' } = req.body;
    
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

Be specific and provide working code that fixes the issue.`;
          
          userPrompt = `Fix this error and provide the corrected code: ${error}\n\nContext: ${description || 'No additional context'}\n\nI need the actual fixed code, not just instructions.`;
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
        
        // If this is a fix_and_apply action, try to extract the fixed code
        let fixedCode = null;
        let filesChanged = [];
        
        if (action === 'fix_and_apply') {
          const codeMatch = solution.match(/FIXED_CODE:\s*([\s\S]*?)(?=\n\n|$)/);
          if (codeMatch) {
            fixedCode = codeMatch[1].trim();
            filesChanged = ['Automatically detected files'];
          }
        }
        
        res.json({
          success: true,
          solution: solution,
          fixedCode: fixedCode,
          filesChanged: filesChanged,
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

// Default route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// CLI route
app.get('/cli', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'cli.html'));
});

// Alternative CLI route
app.get('/cli.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'cli.html'));
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
