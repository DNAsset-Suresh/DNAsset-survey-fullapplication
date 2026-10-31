import { api } from './api.js';
import { toast } from './ui.js';

// Automatically downscales high-res mobile camera photos to prevent hitting cloud payload limits (4.5 MB)
async function compressImageIfNeeded(file) {
  if (!file.type.startsWith('image/') || file.size <= 1.5 * 1024 * 1024) return file;
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const maxDim = 2048;
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (!blob || blob.size >= file.size) {
          resolve(file);
        } else {
          const compressed = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
            type: 'image/jpeg',
            lastModified: Date.now()
          });
          resolve(compressed);
        }
      }, 'image/jpeg', 0.85);
    };
    img.onerror = () => resolve(file);
    img.src = url;
  });
}

export async function uploadFiles(files, documentId, propertyId, maxBytes, refresh, replaceId = null) {
  if (!files.length) return;
  const acceptedExtensions = ['pdf', 'jpg', 'jpeg', 'png', 'xlsx', 'xls', 'csv'];

  for (const file of files) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!acceptedExtensions.includes(ext)) {
      throw new Error('Choose PDF, Excel (.xlsx, .xls), CSV, JPG, or PNG files.');
    }
    if (!file.size) {
      throw new Error(`File "${file.name}" is empty.`);
    }
  }

  let done = 0;
  try {
    for (let file of files) {
      toast(`Preparing ${done + 1} of ${files.length}: ${file.name}…`);
      file = await compressImageIfNeeded(file);

      // Cloud Serverless Functions have a 4.5 MB hard limit on Vercel
      const cloudLimit = 4.2 * 1024 * 1024;
      if (file.size > cloudLimit) {
        throw new Error(`"${file.name}" (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds the 4.2 MB cloud upload limit. Please compress it before uploading.`);
      }

      toast(`Uploading ${done + 1} of ${files.length}: ${file.name}…`);
      const body = new FormData();
      body.append('file', file);
      if (replaceId) body.append('replace_id', replaceId);

      await api(`/properties/${propertyId}/documents/${documentId}/files`, { method: 'POST', body });
      done++;
    }
    toast(`${done} file${done === 1 ? '' : 's'} uploaded successfully.`);
  } catch (error) {
    let msg = error.message;
    if (msg === 'Failed to fetch') {
      msg = 'Network connection interrupted during upload. Please check your mobile signal and try again.';
    }
    throw new Error(`${done} of ${files.length} files saved. ${msg}`);
  } finally {
    await refresh();
  }
}

export async function openFile(id, download = false) {
  const win = download ? null : window.open('about:blank', '_blank');
  if (win) win.opener = null;
  try {
    const { url } = await api(`/files/${id}/url${download ? '?download=1' : ''}`);
    if (win) win.location.href = url;
    else {
      const a = document.createElement('a');
      a.href = url;
      a.rel = 'noopener';
      a.target = '_blank';
      a.click();
    }
  } catch (error) {
    win?.close();
    throw error;
  }
}
