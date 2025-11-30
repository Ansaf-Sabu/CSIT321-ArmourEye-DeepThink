const fs = require('fs');
const path = require('path');
const Docker = require('dockerode');

const DATA_DIR = path.join(__dirname, '../data');
const STORE_FILE = path.join(DATA_DIR, 'user-images.json');

function getDockerClient() {
  if (process.platform === 'win32') {
    return new Docker({ socketPath: '//./pipe/docker_engine' });
  }
  return new Docker({ socketPath: '/var/run/docker.sock' });
}

function ensureStoreFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(STORE_FILE)) {
    fs.writeFileSync(STORE_FILE, JSON.stringify([]));
  }
}

function readStore() {
  ensureStoreFile();
  try {
    const raw = fs.readFileSync(STORE_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (Array.isArray(data)) {
      return data;
    }
    return [];
  } catch (error) {
    console.error('Failed to read user image store:', error);
    return [];
  }
}

function writeStore(data) {
  ensureStoreFile();
  fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2));
}

async function addImage({ repoTag, imageId }) {
  if (!repoTag && !imageId) {
    return null;
  }

  const store = readStore();
  const duplicate = store.find(img => {
    if (repoTag && img.repoTag === repoTag) return true;
    if (imageId && img.imageId === imageId) return true;
    return false;
  });

  if (duplicate) {
    // Update repo tag or id if missing
    if (repoTag && !duplicate.repoTag) duplicate.repoTag = repoTag;
    if (imageId && !duplicate.imageId) duplicate.imageId = imageId;
    writeStore(store);
    return duplicate;
  }

  const entry = {
    id: `user-img-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    repoTag: repoTag || null,
    imageId: imageId || null,
    addedAt: new Date().toISOString()
  };
  store.push(entry);
  writeStore(store);
  return entry;
}

async function addImagesFromRepoTags(repoTags = []) {
  const docker = getDockerClient();
  for (const tag of repoTags) {
    if (!tag) continue;
    try {
      const inspection = await docker.getImage(tag).inspect();
      await addImage({ repoTag: tag, imageId: inspection?.Id });
    } catch (error) {
      console.warn(`Failed to inspect image ${tag} while recording upload:`, error.message);
      await addImage({ repoTag: tag });
    }
  }
}

function getUserImages() {
  return readStore();
}

function getRepoTagSet() {
  const tags = readStore().map(img => img.repoTag).filter(Boolean);
  return new Set(tags);
}

function getImageIdSet() {
  const ids = readStore().map(img => img.imageId).filter(Boolean);
  return new Set(ids);
}

function removeImageByIdentifier(identifier) {
  if (!identifier) return false;
  const store = readStore();
  const filtered = store.filter(img => img.repoTag !== identifier && img.imageId !== identifier);
  if (filtered.length === store.length) {
    return false;
  }
  writeStore(filtered);
  return true;
}

function removeImageEntry({ repoTag, imageId }) {
  const identifiers = [repoTag, imageId].filter(Boolean);
  if (identifiers.length === 0) return false;
  let removed = false;
  identifiers.forEach(id => {
    removed = removeImageByIdentifier(id) || removed;
  });
  return removed;
}

module.exports = {
  addImage,
  addImagesFromRepoTags,
  getUserImages,
  getRepoTagSet,
  getImageIdSet,
  removeImageEntry,
  removeImageByIdentifier
};

