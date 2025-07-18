
# AI Coding Assistant CLI

A command-line interface for the AI Coding Assistant that allows you to interact with your AI assistant directly from the terminal.

## Features

- 💬 **Chat with AI** - Have conversations with your AI assistant
- 🔧 **Generate Code** - Create code snippets and files using AI
- 📁 **Repository Management** - Connect to and manage GitHub repositories
- 🧠 **Memory Context** - AI remembers your project history and conversations
- 🎨 **Colored Output** - Beautiful terminal interface with syntax highlighting

## Installation & Usage

### 1. Start the Server
First, make sure your AI Coding Assistant server is running:
```bash
npm start
```

### 2. Run the CLI
In a new terminal, start the CLI:
```bash
npm run cli
```

## Available Commands

| Command | Description | Example |
|---------|-------------|---------|
| `/help` | Show help message | `/help` |
| `/status` | Check server status | `/status` |
| `/repos` | List GitHub repositories | `/repos` |
| `/select` | Select a repository | `/select owner/repo-name` |
| `/code` | Generate code with AI | `/code create a react component` |
| `/clear` | Clear conversation history | `/clear` |
| `/exit` | Exit the CLI | `/exit` |

## Examples

### Basic Chat
```
AI CLI > How do I create a React component?
🤖 AI Assistant: Here's how to create a React component...
```

### Generate Code
```
AI CLI > /code create a login form with validation
Generating code...
Generated javascript code:

import React, { useState } from 'react';
// ... complete code here
```

### Repository Management
```
AI CLI > /repos
Available repositories:
  1. myusername/my-project - A cool web app
  2. myusername/another-repo - React application

AI CLI > /select myusername/my-project
✓ Connected to myusername/my-project

[my-project] > Let's add a new feature to this project
```

## Configuration

The CLI automatically saves your preferences in `.cli-config.json`:
- Server URL (default: http://localhost:5000)
- Current repository selection
- Session ID for conversation continuity

## Prerequisites

- Node.js installed
- AI Coding Assistant server running
- GitHub token configured (for repository features)
- DeepSeek API key configured (for AI features)

## Troubleshooting

**Cannot connect to server:**
- Make sure the server is running with `npm start`
- Check if port 5000 is available
- Verify environment variables are set

**GitHub features not working:**
- Ensure `GITHUB_TOKEN` is set in your environment
- Check token permissions for repository access

**AI not responding:**
- Verify `DEEPSEEK_API_KEY` is configured
- Check your API quota and limits

## Tips

1. **Use descriptive prompts** - The more specific your request, the better the AI response
2. **Select a repository** - AI works better with project context
3. **Use commands** - Commands like `/code` are optimized for specific tasks
4. **Check status** - Use `/status` to verify server connectivity

Happy coding! 🚀
