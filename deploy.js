const fs = require('fs');
const path = require('path');
require('dotenv').config();

const OBSIDIAN_VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH;
const PLUGIN_ID = process.env.PLUGIN_ID || 'obsidian-rapid-notes';

function copyFile(src, dest) {
    try {
        fs.copyFileSync(src, dest);
        console.log(`✅ Copied ${path.basename(src)} to ${dest}`);
        return true;
    } catch (error) {
        console.error(`❌ Failed to copy ${path.basename(src)}: ${error.message}`);
        return false;
    }
}

function deployPlugin() {
    if (!OBSIDIAN_VAULT_PATH) {
        console.log('🔧 No OBSIDIAN_VAULT_PATH configured in .env file');
        console.log('💡 To enable auto-deployment:');
        console.log('   1. Copy .env.example to .env');
        console.log('   2. Set OBSIDIAN_VAULT_PATH to your Obsidian vault path');
        console.log('   3. Run npm run build again');
        return;
    }

    const pluginDir = path.join(OBSIDIAN_VAULT_PATH, '.obsidian', 'plugins', PLUGIN_ID);
    
    // Check if vault path exists
    if (!fs.existsSync(OBSIDIAN_VAULT_PATH)) {
        console.error(`❌ Obsidian vault path does not exist: ${OBSIDIAN_VAULT_PATH}`);
        console.log('💡 Please check your OBSIDIAN_VAULT_PATH in .env file');
        return;
    }

    // Create plugin directory if it doesn't exist
    if (!fs.existsSync(pluginDir)) {
        try {
            fs.mkdirSync(pluginDir, { recursive: true });
            console.log(`📁 Created plugin directory: ${pluginDir}`);
        } catch (error) {
            console.error(`❌ Failed to create plugin directory: ${error.message}`);
            return;
        }
    }

    console.log(`🚀 Deploying plugin to: ${pluginDir}`);

    // Files to copy
    const filesToCopy = [
        { src: 'main.js', required: true },
        { src: 'manifest.json', required: true },
        { src: 'styles.css', required: false }
    ];

    let allSuccess = true;
    filesToCopy.forEach(({ src, required }) => {
        const srcPath = path.join(__dirname, src);
        const destPath = path.join(pluginDir, src);
        
        if (fs.existsSync(srcPath)) {
            if (!copyFile(srcPath, destPath)) {
                allSuccess = false;
            }
        } else if (required) {
            console.error(`❌ Required file not found: ${src}`);
            allSuccess = false;
        } else {
            console.log(`⚠️ Optional file not found: ${src}`);
        }
    });

    if (allSuccess) {
        console.log('✨ Plugin deployed successfully!');
        console.log('💡 You may need to reload Obsidian or toggle the plugin in settings');
    } else {
        console.log('⚠️ Plugin deployment completed with some errors');
    }
}

deployPlugin();
