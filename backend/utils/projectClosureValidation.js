const sanitizeHtml = require('sanitize-html');
const { validateAttachmentFilename } = require('./taskValidation');

const MIME_BY_EXTENSION = {
  csv:'text/csv',
  doc:'application/msword',
  docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  gif:'image/gif',
  gz:'application/gzip',
  jpeg:'image/jpeg',
  jpg:'image/jpeg',
  pdf:'application/pdf',
  png:'image/png',
  ppt:'application/vnd.ms-powerpoint',
  pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt:'text/plain',
  webp:'image/webp',
  xls:'application/vnd.ms-excel',
  xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip:'application/zip'
};

function sanitizeClosingRemarks(value) {
  if (typeof value !== 'string') return { valid:false, message:'Closing remarks are required' };
  const plainText = sanitizeHtml(value, { allowedTags:[], allowedAttributes:{} })
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
  if (plainText.length < 10) {
    return { valid:false, message:'Closing remarks must be at least 10 characters' };
  }
  if (plainText.length > 10000) {
    return { valid:false, message:'Closing remarks must be 10,000 characters or fewer' };
  }
  const closingRemarksHtml = `<p>${escapeHtml(plainText).replace(/\r?\n/g, '<br>')}</p>`;
  return { valid:true, plainText, closingRemarksHtml };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function validateClosureLinks(value) {
  if (value === undefined) return { valid:true, links:[] };
  if (!Array.isArray(value) || value.length > 10) {
    return { valid:false, message:'A maximum of 10 project links is allowed' };
  }
  const links = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || typeof entry.url !== 'string') {
      return { valid:false, message:'Each project link must contain a valid URL' };
    }
    const rawUrl = entry.url.trim();
    const label = String(entry.label || '')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      return { valid:false, message:'Enter a valid HTTP or HTTPS link' };
    }
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password
      || rawUrl.length > 2048 || label.length > 100) {
      return { valid:false, message:'Links must use HTTP or HTTPS and labels must be 100 characters or fewer' };
    }
    links.push({ url:url.toString(), label });
  }
  return { valid:true, links };
}

function sniffMimeType(buffer) {
  if (buffer.subarray(0, 4).equals(Buffer.from([0x7f,0x45,0x4c,0x46]))
    || buffer.subarray(0, 2).toString() === 'MZ'
    || buffer.subarray(0, 2).toString() === '#!') {
    return { mime:'application/x-executable', dangerous:true };
  }
  if (buffer.subarray(0, 5).toString() === '%PDF-') return { mime:'application/pdf' };
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return { mime:'image/png' };
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff,0xd8,0xff]))) return { mime:'image/jpeg' };
  if (['GIF87a','GIF89a'].includes(buffer.subarray(0, 6).toString())) return { mime:'image/gif' };
  if (buffer.subarray(0, 4).toString() === 'PK\u0003\u0004') return { mime:'application/zip' };
  if (buffer.subarray(0, 2).equals(Buffer.from([0x1f,0x8b]))) return { mime:'application/gzip' };
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') {
    return { mime:'image/webp' };
  }
  if (buffer.subarray(0, 8).equals(Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]))) {
    return { mime:'application/x-ole-storage' };
  }
  return { mime:'' };
}

function validateClosureUpload({ filename, data, mime, maxBytes }) {
  const filenameCheck = validateAttachmentFilename(filename);
  if (!filenameCheck.valid) return { valid:false, message:filenameCheck.message };
  if (/[\u0000-\u001f\u007f]/.test(filenameCheck.originalName) || filenameCheck.originalName.length > 255) {
    return { valid:false, message:'Attachment filenames must be 255 characters or fewer and contain no control characters' };
  }
  if (typeof data !== 'string') return { valid:false, message:'Attachment data is required' };
  const matches = data.match(/^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/);
  if (!matches) return { valid:false, message:'Attachment data must be valid base64' };
  const dataMime = matches[1].toLowerCase();
  const declaredMime = String(mime || dataMime).toLowerCase();
  if (!/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(declaredMime) || declaredMime !== dataMime) {
    return { valid:false, message:'Attachment MIME type is invalid or does not match its file data' };
  }
  const buffer = Buffer.from(matches[2], 'base64');
  if (!buffer.length) return { valid:false, message:'Attachment is empty' };
  if (buffer.length > maxBytes) return { valid:false, message:`Attachments must be ${Math.floor(maxBytes / (1024 * 1024))} MB or smaller` };

  const sniffed = sniffMimeType(buffer);
  if (sniffed.dangerous) return { valid:false, message:'Executable content cannot be uploaded' };
  const extensionMime = MIME_BY_EXTENSION[filenameCheck.extension];
  const zipOfficeMime = sniffed.mime === 'application/zip'
    && ['docx','pptx','xlsx'].includes(filenameCheck.extension)
    && declaredMime.startsWith('application/vnd.openxmlformats-officedocument.');
  if (sniffed.mime && sniffed.mime !== declaredMime && !zipOfficeMime
    && !(sniffed.mime === 'application/x-ole-storage'
      && (declaredMime.startsWith('application/vnd.ms-') || declaredMime === 'application/msword'))) {
    return { valid:false, message:'Attachment content does not match its MIME type' };
  }
  if (extensionMime && declaredMime !== extensionMime
    && !(filenameCheck.extension === 'doc' && sniffed.mime === 'application/x-ole-storage')) {
    return { valid:false, message:'Attachment extension does not match its MIME type' };
  }
  return {
    valid:true,
    originalName:filenameCheck.originalName,
    extension:filenameCheck.extension,
    mime:sniffed.mime || declaredMime,
    buffer
  };
}

module.exports = {
  sanitizeClosingRemarks,
  validateClosureLinks,
  validateClosureUpload,
  sniffMimeType
};
