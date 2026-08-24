import { projectResourceFiles } from './function-inputs.js';

let currentFiles = [];

export function setProjectSessionFiles(paths = []) {
  currentFiles = [...new Set(paths.map((value) => String(value || '')).filter(Boolean))];
}

export function projectSessionFiles() {
  return [...currentFiles];
}

export function projectSessionResourceFiles() {
  return projectResourceFiles(currentFiles);
}
