
#!/usr/bin/env node

const axios = require('axios');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

// CLI Configuration
const CLI_CONFIG_FILE = path.join(__dirname, '.cli-config.json');
const DEFAULT_SERVER_URL = 'http://localhost:5000';

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

class AICodingCLI {
  constructor() {
    this.config = this.loadConfig();
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  loadConfig() {
    try {
      if (fs.existsSync(CLI_CONFIG_FILE)) {
        return JSON.parse(fs.readFileSync(CLI_CONFIG_FILE, 'utf8'));
      }
    } catch (error) {
      console.log(`${colors.yellow}Warning: Could not load CLI config${colors.reset}`);
    }
    
    return {
      serverUrl: DEFAULT_SERVER_URL,
      currentRepo: null,
      sessionId: 'cli-session'
    };
  }

  saveConfig() {
    try {
      fs.writeFileSync(CLI_CONFIG_FILE, JSON.stringify(this.config, null, 2));
    } catch (error) {
      console.log(`${colors.red}Warning: Could not save CLI config${colors.reset}`);
    }
  }

  cleanup() {
    if (this.rl) {
      this.rl.close();
    }
    process.exit(0);
  }

  async checkServerHealth() {
    try {
      const response = await axios.get(`${this.config.serverUrl}/api/health`);
      return response.data.success;
    } catch (error) {
      return false;
    }
  }

  async sendMessage(message) {
    try {
      const response = await axios.post(`${this.config.serverUrl}/api/chat`, {
        message: message,
        selectedRepo: this.config.currentRepo,
        sessionId: this.config.sessionId
      });

      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.error || error.message);
    }
  }

  async generateCode(prompt, language = 'javascript') {
    try {
      const response = await axios.post(`${this.config.serverUrl}/api/generate-code`, {
        prompt: prompt,
        language: language,
        repoName: this.config.currentRepo?.full_name || 'cli-session'
      });

      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.error || error.message);
    }
  }

  async listRepos() {
    try {
      const response = await axios.get(`${this.config.serverUrl}/api/github/repos`);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.error || error.message);
    }
  }

  async selectRepo(repoFullName) {
    try {
      const response = await axios.post(`${this.config.serverUrl}/api/repo/select`, {
        repo: { full_name: repoFullName }
      });

      if (response.data.success) {
        this.config.currentRepo = response.data.repository;
        this.saveConfig();
      }

      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.error || error.message);
    }
  }

  printWelcome() {
    console.log(`${colors.cyan}${colors.bright}`);
    console.log('┌─────────────────────────────────────────┐');
    console.log('│        🤖 AI Coding Assistant CLI       │');
    console.log('└─────────────────────────────────────────┘');
    console.log(`${colors.reset}`);
    console.log(`${colors.green}Connected to: ${this.config.serverUrl}${colors.reset}`);
    
    if (this.config.currentRepo) {
      console.log(`${colors.blue}Current repo: ${this.config.currentRepo.full_name}${colors.reset}`);
    } else {
      console.log(`${colors.yellow}No repository selected${colors.reset}`);
    }
    
    console.log(`\n${colors.cyan}Available commands:${colors.reset}`);
    console.log('  /help     - Show this help message');
    console.log('  /repos    - List GitHub repositories');
    console.log('  /select   - Select a repository');
    console.log('  /code     - Generate code with AI');
    console.log('  /status   - Check server status');
    console.log('  /clear    - Clear conversation');
    console.log('  /exit     - Exit CLI');
    console.log(`  ${colors.green}Or just type your message to chat with AI${colors.reset}\n`);
  }

  async processCommand(input) {
    const trimmed = input.trim();
    
    if (trimmed.startsWith('/')) {
      const [command, ...args] = trimmed.slice(1).split(' ');
      
      switch (command.toLowerCase()) {
        case 'help':
          this.printWelcome();
          break;
          
        case 'status':
          const isHealthy = await this.checkServerHealth();
          console.log(`${isHealthy ? colors.green : colors.red}Server: ${isHealthy ? 'Online' : 'Offline'}${colors.reset}`);
          break;
          
        case 'repos':
          try {
            const repos = await this.listRepos();
            console.log(`${colors.cyan}Available repositories:${colors.reset}`);
            repos.repos.forEach((repo, index) => {
              console.log(`  ${index + 1}. ${colors.bright}${repo.full_name}${colors.reset} - ${repo.description || 'No description'}`);
            });
          } catch (error) {
            console.log(`${colors.red}Error: ${error.message}${colors.reset}`);
          }
          break;
          
        case 'select':
          const repoName = args.join(' ');
          if (!repoName) {
            console.log(`${colors.yellow}Usage: /select owner/repo-name${colors.reset}`);
            break;
          }
          
          try {
            const result = await this.selectRepo(repoName);
            console.log(`${colors.green}✓ Connected to ${result.repository.full_name}${colors.reset}`);
          } catch (error) {
            console.log(`${colors.red}Error: ${error.message}${colors.reset}`);
          }
          break;
          
        case 'code':
          const codePrompt = args.join(' ');
          if (!codePrompt) {
            console.log(`${colors.yellow}Usage: /code <description of what you want to build>${colors.reset}`);
            break;
          }
          
          try {
            console.log(`${colors.yellow}Generating code...${colors.reset}`);
            const result = await this.generateCode(codePrompt);
            console.log(`${colors.green}Generated ${result.language} code:${colors.reset}\n`);
            console.log(`${colors.bright}${result.code}${colors.reset}\n`);
          } catch (error) {
            console.log(`${colors.red}Error: ${error.message}${colors.reset}`);
          }
          break;
          
        case 'clear':
          try {
            await axios.post(`${this.config.serverUrl}/api/clear-conversation`, {
              repoName: this.config.currentRepo?.full_name
            });
            console.log(`${colors.green}✓ Conversation cleared${colors.reset}`);
          } catch (error) {
            console.log(`${colors.red}Error: ${error.message}${colors.reset}`);
          }
          break;
          
        case 'exit':
          console.log(`${colors.cyan}Goodbye! 👋${colors.reset}`);
          this.cleanup();
          break;
          
        default:
          console.log(`${colors.red}Unknown command: ${command}${colors.reset}`);
          console.log(`${colors.yellow}Type /help for available commands${colors.reset}`);
      }
    } else {
      // Regular chat message
      if (!trimmed) return;
      
      try {
        console.log(`${colors.yellow}AI is thinking...${colors.reset}`);
        const result = await this.sendMessage(trimmed);
        
        console.log(`${colors.magenta}🤖 AI Assistant:${colors.reset}`);
        console.log(result.response);
        
        if (result.memoryContext) {
          console.log(`${colors.cyan}Memory: ${result.memoryContext.totalConversations} conversations${colors.reset}`);
        }
        console.log('');
      } catch (error) {
        console.log(`${colors.red}Error: ${error.message}${colors.reset}`);
      }
    }
  }

  async start() {
    // Check if server is running
    const isHealthy = await this.checkServerHealth();
    if (!isHealthy) {
      console.log(`${colors.red}❌ Cannot connect to AI server at ${this.config.serverUrl}${colors.reset}`);
      console.log(`${colors.yellow}Make sure the server is running with: npm start${colors.reset}`);
      process.exit(1);
    }

    this.printWelcome();
    
    const askQuestion = () => {
      const prompt = this.config.currentRepo 
        ? `${colors.blue}[${this.config.currentRepo.name}]${colors.reset} > `
        : `${colors.cyan}AI CLI${colors.reset} > `;
        
      this.rl.question(prompt, async (input) => {
        await this.processCommand(input);
        askQuestion();
      });
    };

    askQuestion();
  }
}

// Handle CTRL+C gracefully
process.on('SIGINT', () => {
  console.log(`\n${colors.cyan}Goodbye! 👋${colors.reset}`);
  if (module.exports.instance) {
    module.exports.instance.cleanup();
  } else {
    process.exit(0);
  }
});

// Start CLI if run directly
if (require.main === module) {
  const cli = new AICodingCLI();
  module.exports.instance = cli;
  cli.start().catch(error => {
    console.error(`${colors.red}CLI Error: ${error.message}${colors.reset}`);
    process.exit(1);
  });
}

module.exports = AICodingCLI;
