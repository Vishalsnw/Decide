const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');

class ReactNativeBuilder {
  constructor(domain, projectName, options = {}) {
    this.domain = domain;
    this.projectName = projectName || domain.replace(/[^a-zA-Z0-9]/g, '');
    this.repoUrl = options.repoUrl;
    this.repoName = options.repoName;
    this.useRepo = !!this.repoUrl;

    // If using repo, create in repo directory, otherwise use projects directory
    if (this.useRepo) {
      this.projectPath = path.join(__dirname, 'repos', this.repoName || this.projectName);
    } else {
      this.projectPath = path.join(__dirname, 'projects', this.projectName);
    }

    this.buildAttempts = 0;
    this.maxAttempts = 3;
    this.buildOutputPath = path.join(this.projectPath, 'builds');
  }

  async createProject() {
    console.log(`🚀 Creating React Native app for domain: ${this.domain}`);

    try {
      // Clone repository if provided
      if (this.useRepo) {
        await this.cloneRepository();
      }

      // Create project directory if not using repo
      if (!this.useRepo) {
        if (!fs.existsSync(path.dirname(this.projectPath))) {
          fs.mkdirSync(path.dirname(this.projectPath), { recursive: true });
        }
      }

      // Initialize React Native project if not cloning from repo
      if (!this.useRepo) {
        await this.executeCommand('npx react-native init ' + this.projectName, path.dirname(this.projectPath));
      }

      // Configure domain integration
      await this.configureDomain();

      // Setup Gradle
      await this.setupGradle();

      // Install dependencies
      await this.installDependencies();

      // Build and test
      await this.buildAndTest();

      return {
        success: true,
        projectPath: this.projectPath,
        domain: this.domain,
        builds: this.completedBuilds
      };
    } catch (error) {
      console.error('Project creation failed:', error);
      throw error;
    }
  }

  async cloneRepository() {
    console.log(`Cloning repository: ${this.repoUrl}`);
    if (!fs.existsSync(this.projectPath)) {
      fs.mkdirSync(this.projectPath, { recursive: true });
    }
    await this.executeCommand(`git clone ${this.repoUrl} .`, this.projectPath);
    console.log('Repository cloned successfully.');
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

    // Install React Native dependencies
    await this.executeCommand('npm install', this.projectPath);

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

  async executeCommand(command, cwd) {
    return new Promise((resolve, reject) => {
      console.log(`Executing: ${command}`);
      const process = spawn('sh', ['-c', command], { 
        cwd: cwd,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        stdout += data.toString();
        console.log(data.toString().trim());
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
        console.error(data.toString().trim());
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`Command failed with code ${code}: ${stderr || stdout}`));
        }
      });
    });
  }
}

module.exports = ReactNativeBuilder;