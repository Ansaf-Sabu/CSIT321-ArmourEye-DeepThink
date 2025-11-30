/**
 * Quick script to update the remote AI URL
 * Run: node backend/ai/update_remote_url.js <CLOUDFLARE_URL>
 * 
 * Example:
 *   node backend/ai/update_remote_url.js https://prix-hill-subscribe-jewelry.trycloudflare.com
 */

const aiSettingsStore = require('./aiSettingsStore');

const cloudflareUrl = process.argv[2];

if (!cloudflareUrl) {
  console.error('❌ Please provide the Cloudflare URL as an argument');
  console.log('\nUsage:');
  console.log('  node backend/ai/update_remote_url.js <CLOUDFLARE_URL>');
  console.log('\nExample:');
  console.log('  node backend/ai/update_remote_url.js https://prix-hill-subscribe-jewelry.trycloudflare.com');
  process.exit(1);
}

try {
  const updated = aiSettingsStore.update({ remoteUrl: cloudflareUrl });
  console.log('✅ Remote URL updated successfully!');
  console.log(`   URL: ${updated.remoteUrl}`);
  console.log(`   Mode: ${updated.mode}`);
  console.log('\n💡 You can now switch to Remote mode in the ArmourEye GUI');
} catch (error) {
  console.error('❌ Failed to update URL:', error.message);
  process.exit(1);
}

