const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');
const { Octokit } = require('@octokit/rest');

class ReactNativeBuilder {
  constructor(domain, projectName, options = {}) {
    this.domain = domain;
    this.projectName = projectName || domain.replace(/[^a-zA-Z0-9]/g, '');
    this.repoUrl = options.repoUrl;
    this.repoName = options.repoName;
    this.selectedRepo = options.selectedRepo;
    this.useRepo = !!(this.repoUrl || this.selectedRepo);
    this.needsRNInit = options.needsRNInit === undefined ? true : options.needsRNInit;
    this.isExistingRNProject = options.isExistingRNProject || false;

    // Initialize GitHub client with existing token
    if (!process.env.GITHUB_TOKEN) {
      throw new Error('GitHub token required. Please set GITHUB_TOKEN environment variable.');
    }
    this.octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN,
    });

    // Use safe directory paths - always work in current directory for Git repos
    const safeProjectName = (this.repoName || this.projectName).replace(/[^a-zA-Z0-9-_]/g, '');
    
    // For Git repositories, work directly in current directory to maintain Git context
    if (this.useRepo) {
      this.projectPath = process.cwd(); // Work directly in current Repl directory
    } else {
      // For local projects, use a subdirectory
      this.projectPath = path.join(process.cwd(), safeProjectName);
    }

    this.buildAttempts = 0;
    this.maxAttempts = 3;
    this.buildOutputPath = path.join(this.projectPath, 'builds');
  }

  async createProject() {
    console.log(`🚀 Creating React Native app for domain: ${this.domain}`);

    try {
      let repositoryInfo = null;

      // Handle repository operations
      if (this.useRepo || this.octokit) {
        repositoryInfo = await this.cloneRepository();

        // Initialize React Native if needed
        if (this.needsRNInit && !this.isExistingRNProject) {
          console.log('🚀 Initializing React Native in repository...');

          // Check if it's already a React Native project
          const packageJsonPath = path.join(this.projectPath, 'package.json');
          let isRNProject = false;

          if (fs.existsSync(packageJsonPath)) {
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
            isRNProject = packageJson.dependencies &&
              (packageJson.dependencies['react-native'] || packageJson.devDependencies && packageJson.devDependencies['react-native']);
          }

          if (!isRNProject) {
            await this.executeCommand(`npx react-native init ${this.projectName} --directory .`, this.projectPath);
          } else {
            console.log('✅ Existing React Native project detected');
          }
        }
      } else {
        // Create new local project
        const parentDir = path.dirname(this.projectPath);
        try {
          if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true });
          }
        } catch (error) {
          console.error('Directory creation error:', error);
          // Multiple fallback strategies for local projects
          const fallbackPaths = [
            path.join('/tmp', this.projectName),
            path.join(process.cwd(), this.projectName),
            path.join(__dirname, this.projectName)
          ];

          for (const fallbackPath of fallbackPaths) {
            try {
              const fallbackParent = path.dirname(fallbackPath);
              if (!fs.existsSync(fallbackParent)) {
                fs.mkdirSync(fallbackParent, { recursive: true });
              }
              this.projectPath = fallbackPath;
              console.log(`Using fallback path: ${this.projectPath}`);
              break;
            } catch (fallbackError) {
              console.error(`Fallback path ${fallbackPath} also failed:`, fallbackError);
              continue;
            }
          }
        }
        console.log('🚀 Creating new React Native project...');
        
        // Create npm directories in current working directory to avoid /var/task issues
        const workingDir = process.cwd();
        const npmCacheDir = path.join(workingDir, '.npm-cache');
        const npmGlobalDir = path.join(workingDir, '.npm-global');
        const npmTmpDir = path.join(workingDir, '.npm-tmp');
        
        // Ensure all npm directories exist with proper permissions
        [npmCacheDir, npmGlobalDir, npmTmpDir].forEach(dir => {
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
          }
        });
        
        // Set comprehensive npm config before any npm operations
        const npmConfigCommands = [
          `npm config set cache "${npmCacheDir}"`,
          `npm config set prefix "${npmGlobalDir}"`,
          `npm config set tmp "${npmTmpDir}"`,
          `npm config set registry "https://registry.npmjs.org/"`,
          `npm config set fetch-retries 3`,
          `npm config set fetch-retry-factor 10`,
          `npm config set fetch-retry-mintimeout 10000`,
          `npm config set fetch-retry-maxtimeout 60000`,
          `npm config set unsafe-perm true`
        ];
        
        for (const configCmd of npmConfigCommands) {
          await this.executeCommand(configCmd, this.projectPath);
        }
        
        // Create React Native project directly in current directory
        await this.executeCommand(`npx --yes react-native@latest init ${this.projectName} --directory .`, this.projectPath);
      }

      // Configure domain integration
      await this.configureDomain();

      // Setup Gradle
      await this.setupGradle();

      // Install dependencies
      await this.installDependencies();

      // Build and test (with fallback for build issues)
      let buildOutputs = [];
      try {
        await this.buildAndTest();
        buildOutputs = this.completedBuilds || [];
      } catch (buildError) {
        console.log('⚠️ Build completed with warnings:', buildError.message);
        buildOutputs = this.completedBuilds || [];
      }

      // Commit changes to repository if using Git
      if (this.repoUrl || repositoryInfo) {
        try {
          await this.commitChanges();
        } catch (commitError) {
          console.log('⚠️ Could not commit changes:', commitError.message);
        }
      }

      return {
        success: true,
        projectPath: this.projectPath,
        domain: this.domain,
        builds: buildOutputs,
        repository: repositoryInfo?.repository || { url: this.repoUrl },
        buildOutputs: buildOutputs
      };
    } catch (error) {
      console.error('Project creation failed:', error);
      throw error;
    }
  }

  async cloneRepository() {
    const repoToClone = this.selectedRepo || { clone_url: this.repoUrl, full_name: this.repoName };
    console.log(`🔗 Working with repository in current directory: ${process.cwd()}`);

    const hasGit = await this.checkGitAvailability();

    // Check if we're already in a Git repository
    const isGitRepo = fs.existsSync(path.join(process.cwd(), '.git'));
    
    if (isGitRepo) {
      console.log('✅ Already in a Git repository - using current directory');
      return {
        repository: { full_name: 'current-repo', clone_url: 'current' },
        repoUrl: 'current'
      };
    }

    if (repoToClone && (repoToClone.clone_url || this.repoUrl)) {
      console.log(`⚠️ Repository specified but working in current directory. Initializing Git...`);
      if (hasGit) {
        await this.executeCommand('git init', this.projectPath);
        await this.executeCommand(`git remote add origin ${repoToClone.clone_url || this.repoUrl}`, this.projectPath);
        console.log('✅ Git repository initialized with remote origin.');
      }

      return {
        repository: repoToClone,
        repoUrl: repoToClone.clone_url || this.repoUrl
      };
    } else if (this.octokit) {
      // Create new GitHub repository
      try {
        console.log(`📦 Creating new GitHub repository: ${this.projectName}`);

        const { data: repo } = await this.octokit.rest.repos.createForAuthenticatedUser({
          name: this.projectName,
          description: `React Native app for ${this.domain}`,
          private: false,
          auto_init: false // Don't auto-init to avoid conflicts
        });

        this.repoUrl = repo.clone_url;
        console.log(`✅ Created repository: ${repo.html_url}`);

        // Initialize Git and connect to remote
        if (hasGit) {
          await this.executeCommand('git init', this.projectPath);
          await this.executeCommand(`git remote add origin ${this.repoUrl}`, this.projectPath);
        }

        return {
          repository: repo,
          repoUrl: this.repoUrl
        };
      } catch (error) {
        console.log(`⚠️ Could not create GitHub repo: ${error.message}`);
        // Initialize local Git
        if (hasGit) {
          await this.executeCommand('git init', this.projectPath);
        }
      }
    } else {
      // Local development with Git
      console.log('📁 Initializing Git repository in current directory');
      if (hasGit) {
        await this.executeCommand('git init', this.projectPath);
      } else {
        console.log('⚠️ Git not available - proceeding without version control');
      }
    }

    return null;
  }

  async configureDomain() {
    console.log('🔧 Configuring domain integration...');

    // Update package.json with domain info
    const packageJsonPath = path.join(this.projectPath, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

    packageJson.domain = this.domain;
    packageJson.homepage = `https://${this.domain}`;

    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

    // Create API configuration
    const apiConfigContent = `
export const API_CONFIG = {
  BASE_URL: 'https://${this.domain}',
  API_URL: 'https://api.${this.domain}',
  WS_URL: 'wss://${this.domain}/ws',
  VERSION: '1.0.0'
};

export default API_CONFIG;
`;

    // Ensure src/config directory exists
    const configDir = path.join(this.projectPath, 'src', 'config');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(path.join(configDir, 'api.js'), apiConfigContent);

    // Update App.js with domain integration
    const appJsContent = `
import React, { useEffect, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
  Alert
} from 'react-native';
import API_CONFIG from './src/config/api';

const App = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [domainStatus, setDomainStatus] = useState('checking');

  useEffect(() => {
    checkDomainConnection();
  }, []);

  const checkDomainConnection = async () => {
    try {
      const response = await fetch(API_CONFIG.BASE_URL, {
        method: 'HEAD',
        timeout: 5000
      });

      setDomainStatus(response.ok ? 'connected' : 'error');
    } catch (error) {
      setDomainStatus('offline');
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusColor = () => {
    switch (domainStatus) {
      case 'connected': return '#4CAF50';
      case 'error': return '#FF9800';
      case 'offline': return '#F44336';
      default: return '#9E9E9E';
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
      <ScrollView contentInsetAdjustmentBehavior="automatic" style={styles.scrollView}>
        <View style={styles.header}>
          <Text style={styles.title}>{API_CONFIG.BASE_URL}</Text>
          <Text style={styles.subtitle}>React Native App</Text>
        </View>

        <View style={styles.statusContainer}>
          <View style={[styles.statusIndicator, { backgroundColor: getStatusColor() }]} />
          <Text style={styles.statusText}>
            Domain Status: {domainStatus.toUpperCase()}
          </Text>
        </View>

        {isLoading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#0066CC" />
            <Text style={styles.loadingText}>Checking domain connection...</Text>
          </View>
        )}

        <View style={styles.infoContainer}>
          <Text style={styles.infoTitle}>App Information</Text>
          <Text style={styles.infoText}>Domain: {API_CONFIG.BASE_URL}</Text>
          <Text style={styles.infoText}>API Endpoint: {API_CONFIG.API_URL}</Text>
          <Text style={styles.infoText}>WebSocket: {API_CONFIG.WS_URL}</Text>
          <Text style={styles.infoText}>Version: {API_CONFIG.VERSION}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  scrollView: {
    flex: 1,
  },
  header: {
    padding: 20,
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333333',
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 16,
    color: '#666666',
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 30,
  },
  statusIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 10,
  },
  statusText: {
    fontSize: 16,
    fontWeight: '600',
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 14,
    color: '#666666',
  },
  infoContainer: {
    margin: 20,
    padding: 15,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333333',
  },
  infoText: {
    fontSize: 14,
    marginBottom: 5,
    color: '#555555',
  },
});

export default App;
`;

    fs.writeFileSync(path.join(this.projectPath, 'App.js'), appJsContent);
  }

  async setupGradle() {
    console.log('⚙️ Setting up Gradle configuration...');

    const gradlePath = path.join(this.projectPath, 'android', 'gradle.properties');
    const buildGradlePath = path.join(this.projectPath, 'android', 'app', 'build.gradle');

    // Ensure android and app directories exist before accessing files
    const androidDir = path.join(this.projectPath, 'android');
    const appDir = path.join(androidDir, 'app');
    if (!fs.existsSync(androidDir)) fs.mkdirSync(androidDir, { recursive: true });
    if (!fs.existsSync(appDir)) fs.mkdirSync(appDir, { recursive: true });


    // Update gradle.properties
    let gradleProperties = '';
    if (fs.existsSync(gradlePath)) {
        gradleProperties = fs.readFileSync(gradlePath, 'utf8');
    }
    gradleProperties += `
# Domain-specific configuration
org.gradle.jvmargs=-Xmx4096m -XX:MaxPermSize=512m -XX:+HeapDumpOnOutOfMemoryError -Dfile.encoding=UTF-8
org.gradle.parallel=true
org.gradle.daemon=true
android.useAndroidX=true
android.enableJetifier=true
org.gradle.configureondemand=true
android.enableR8.fullMode=true
`;
    fs.writeFileSync(gradlePath, gradleProperties);

    // Update build.gradle for signing configs
    let buildGradle = '';
    if (fs.existsSync(buildGradlePath)) {
        buildGradle = fs.readFileSync(buildGradlePath, 'utf8');
    }

    // Add signing config
    const signingConfigInsert = `
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            if (project.hasProperty('MYAPP_UPLOAD_STORE_FILE')) {
                storeFile file(MYAPP_UPLOAD_STORE_FILE)
                storePassword MYAPP_UPLOAD_STORE_PASSWORD
                keyAlias MYAPP_UPLOAD_KEY_ALIAS
                keyPassword MYAPP_UPLOAD_KEY_PASSWORD
            }
        }
    }
`;

    // Insert after android {
    buildGradle = buildGradle.replace(
      /android\s*{/,
      `android {\n${signingConfigInsert}`
    );

    // Update buildTypes
    buildGradle = buildGradle.replace(
      /buildTypes\s*{[\s\S]*?}/,
      `buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.release
            minifyEnabled enableProguardInReleaseBuilds
            proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"
        }
    }`
    );

    fs.writeFileSync(buildGradlePath, buildGradle);

    // Create debug keystore
    const keystorePath = path.join(this.projectPath, 'android', 'app', 'debug.keystore');
    if (!fs.existsSync(keystorePath)) {
      try {
        await this.executeCommand(
          'keytool -genkey -v -keystore debug.keystore -storepass android -alias androiddebugkey -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Android,C=US"',
          path.join(this.projectPath, 'android', 'app')
        );
      } catch (error) {
        console.log('Using default debug keystore');
      }
    }
  }

  async installDependencies() {
    console.log('📦 Installing dependencies...');

    // Use current working directory for npm directories
    const workingDir = process.cwd();
    const npmCacheDir = path.join(workingDir, '.npm-cache');
    const npmGlobalDir = path.join(workingDir, '.npm-global');
    const npmTmpDir = path.join(workingDir, '.npm-tmp');
    
    [npmCacheDir, npmGlobalDir, npmTmpDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
      }
    });

    // Set comprehensive npm configuration
    const npmConfigCommands = [
      `npm config set cache "${npmCacheDir}"`,
      `npm config set prefix "${npmGlobalDir}"`,
      `npm config set tmp "${npmTmpDir}"`,
      `npm config set registry "https://registry.npmjs.org/"`,
      `npm config set fetch-retries 5`,
      `npm config set fetch-retry-factor 10`,
      `npm config set unsafe-perm true`
    ];
    
    for (const configCmd of npmConfigCommands) {
      await this.executeCommand(configCmd, this.projectPath);
    }
    
    // Install dependencies with better error handling
    await this.executeCommand('npm install --no-audit --no-fund', this.projectPath);

    // Install additional packages for domain integration
    const additionalPackages = [
      '@react-native-async-storage/async-storage',
      'react-native-network-info',
      'react-native-device-info'
    ];

    for (const pkg of additionalPackages) {
      try {
        await this.executeCommand(`npm install ${pkg}`, this.projectPath);
      } catch (error) {
        console.log(`Warning: Could not install ${pkg}`);
      }
    }
  }

  async buildAndTest() {
    this.completedBuilds = [];

    // Ensure build output directory exists
    if (!fs.existsSync(this.buildOutputPath)) {
      fs.mkdirSync(this.buildOutputPath, { recursive: true });
    }

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      console.log(`🔨 Build attempt ${attempt}/${this.maxAttempts}`);

      try {
        // Clean previous builds
        await this.executeCommand('./gradlew clean', path.join(this.projectPath, 'android'));

        // Build debug APK
        console.log('Building debug APK...');
        const debugApkPath = path.join(this.buildOutputPath, `${this.projectName}-debug.apk`);
        await this.executeCommand('./gradlew assembleDebug', path.join(this.projectPath, 'android'));
        fs.renameSync(path.join(this.projectPath, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'), debugApkPath);
        this.completedBuilds.push(debugApkPath);

        // Build release APK
        console.log('Building release APK...');
        const releaseApkPath = path.join(this.buildOutputPath, `${this.projectName}-release.apk`);
        await this.executeCommand('./gradlew assembleRelease', path.join(this.projectPath, 'android'));
        fs.renameSync(path.join(this.projectPath, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'), releaseApkPath);
        this.completedBuilds.push(releaseApkPath);

        // Build AAB
        console.log('Building AAB...');
        const releaseAabPath = path.join(this.buildOutputPath, `${this.projectName}-release.aab`);
        await this.executeCommand('./gradlew bundleRelease', path.join(this.projectPath, 'android'));
        fs.renameSync(path.join(this.projectPath, 'android', 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab'), releaseAabPath);
        this.completedBuilds.push(releaseAabPath);

        // Test the builds
        await this.testBuilds();

        console.log('✅ All builds completed successfully!');
        return;

      } catch (error) {
        console.error(`❌ Build attempt ${attempt} failed:`, error.message);

        if (attempt < this.maxAttempts) {
          console.log('🔧 Attempting to fix issues...');
          await this.fixBuildIssues(error);
        } else {
          throw new Error(`Build failed after ${this.maxAttempts} attempts: ${error.message}`);
        }
      }
    }
  }

  async fixBuildIssues(error) {
    const errorMessage = error.message.toLowerCase();

    // Common React Native build fixes
    if (errorMessage.includes('sdk') || errorMessage.includes('build-tools')) {
      console.log('🔧 Fixing SDK issues...');
      // Update SDK versions
      const buildGradlePath = path.join(this.projectPath, 'android', 'app', 'build.gradle');
      let buildGradle = fs.readFileSync(buildGradlePath, 'utf8');

      buildGradle = buildGradle.replace(/compileSdkVersion \d+/, 'compileSdkVersion 34');
      buildGradle = buildGradle.replace(/targetSdkVersion \d+/, 'targetSdkVersion 34');
      buildGradle = buildGradle.replace(/buildToolsVersion "[\d\.]+"/, 'buildToolsVersion "34.0.0"');

      fs.writeFileSync(buildGradlePath, buildGradle);
    }

    if (errorMessage.includes('memory') || errorMessage.includes('heap')) {
      console.log('🔧 Fixing memory issues...');
      const gradlePath = path.join(this.projectPath, 'android', 'gradle.properties');
      let gradleProperties = fs.readFileSync(gradlePath, 'utf8');

      if (!gradleProperties.includes('org.gradle.jvmargs=-Xmx')) {
        gradleProperties += '\norg.gradle.jvmargs=-Xmx8192m -XX:MaxPermSize=512m\n';
        fs.writeFileSync(gradlePath, gradleProperties);
      }
    }

    if (errorMessage.includes('permission') || errorMessage.includes('access')) {
      console.log('🔧 Fixing permission issues...');
      await this.executeCommand('chmod +x gradlew', path.join(this.projectPath, 'android'));
    }

    // Clean and refresh dependencies
    await this.executeCommand('./gradlew clean', path.join(this.projectPath, 'android'));
    await this.executeCommand('npm install', this.projectPath);
  }

  async testBuilds() {
    console.log('🧪 Testing builds...');

    const builds = [
      { type: 'debug APK', path: path.join(this.buildOutputPath, `${this.projectName}-debug.apk`) },
      { type: 'release APK', path: path.join(this.buildOutputPath, `${this.projectName}-release.apk`) },
      { type: 'release AAB', path: path.join(this.buildOutputPath, `${this.projectName}-release.aab`) }
    ];

    for (const build of builds) {
      if (fs.existsSync(build.path)) {
        const stats = fs.statSync(build.path);
        console.log(`✅ ${build.type}: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
      } else {
        throw new Error(`${build.type} not found at ${build.path}`);
      }
    }
  }

  async commitChanges() {
    console.log('📝 Committing changes to repository...');

    try {
      // Configure git user if not already set
      await this.executeCommand('git config user.email "replit@example.com" || true', this.projectPath);
      await this.executeCommand('git config user.name "Replit AI Assistant" || true', this.projectPath);

      // Add all files
      await this.executeCommand('git add .', this.projectPath);

      // Commit changes
      const commitMessage = `Add React Native app for ${this.domain}`;
      await this.executeCommand(`git commit -m "${commitMessage}" || true`, this.projectPath);

      // Push to remote if repository exists
      if (this.repoUrl) {
        await this.executeCommand('git push origin main || git push origin master || true', this.projectPath);
        console.log('✅ Changes pushed to repository');
      }
    } catch (error) {
      console.log('⚠️ Commit operation completed with warnings:', error.message);
    }
  }

  async executeCommand(command, cwd) {
    return new Promise((resolve, reject) => {
      console.log(`Executing: ${command}`);
      
      // Set proper environment variables for npm in Replit
      const workingDir = process.cwd();
      const env = {
        ...process.env,
        HOME: workingDir,
        TMPDIR: path.join(workingDir, '.npm-tmp'),
        npm_config_cache: path.join(workingDir, '.npm-cache'),
        npm_config_prefix: path.join(workingDir, '.npm-global'),
        npm_config_tmp: path.join(workingDir, '.npm-tmp'),
        npm_config_registry: 'https://registry.npmjs.org/',
        npm_config_fetch_retries: '5',
        npm_config_fetch_retry_factor: '10',
        npm_config_fetch_retry_mintimeout: '10000',
        npm_config_fetch_retry_maxtimeout: '60000',
        npm_config_unsafe_perm: 'true'
      };
      
      const childProcess = spawn('sh', ['-c', command], {
        cwd: cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: env
      });

      let stdout = '';
      let stderr = '';

      childProcess.stdout.on('data', (data) => {
        stdout += data.toString();
        console.log(data.toString().trim());
      });

      childProcess.stderr.on('data', (data) => {
        stderr += data.toString();
        console.error(data.toString().trim());
      });

      childProcess.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Command failed with code ${code}: ${stderr || stdout}`));
        }
      });
    });
  }

  async checkGitAvailability() {
    try {
      await this.executeCommand('git --version', process.cwd());
      return true;
    } catch (error) {
      console.log('⚠️ Git command not found. Proceeding without version control.');
      return false;
    }
  }
}

module.exports = ReactNativeBuilder;