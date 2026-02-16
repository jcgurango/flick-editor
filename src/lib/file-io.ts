import type { Project } from '../types/project'
import { renderFrameToSvg } from './svg-export'

// ── File System Access API type declarations ──

declare global {
  interface Window {
    showOpenFilePicker?: (options?: {
      types?: { description: string; accept: Record<string, string[]> }[]
      multiple?: boolean
    }) => Promise<FileSystemFileHandle[]>
    showSaveFilePicker?: (options?: {
      suggestedName?: string
      types?: { description: string; accept: Record<string, string[]> }[]
    }) => Promise<FileSystemFileHandle>
    showDirectoryPicker?: (options?: {
      mode?: 'read' | 'readwrite'
    }) => Promise<FileSystemDirectoryHandle>
  }
  interface FileSystemFileHandle {
    getFile(): Promise<File>
    createWritable(): Promise<FileSystemWritableFileStream>
    name: string
  }
  interface FileSystemDirectoryHandle {
    getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>
  }
  interface FileSystemWritableFileStream extends WritableStream {
    write(data: string | Blob | ArrayBuffer): Promise<void>
    close(): Promise<void>
  }
}

// ── Module state ──

let currentFileHandle: FileSystemFileHandle | null = null
let currentFileName = ''

const hasFileSystemAccess = typeof window !== 'undefined' && 'showOpenFilePicker' in window

const FLICK_FILE_TYPE = {
  description: 'Flick Project',
  accept: { 'application/json': ['.flick'] } as Record<string, string[]>,
}

// ── Public API ──

export function getCurrentFileName(): string {
  return currentFileName
}

export function clearFileHandle(): void {
  currentFileHandle = null
  currentFileName = ''
}

export async function openProject(): Promise<{ project: Project; name: string } | null> {
  if (hasFileSystemAccess) {
    try {
      const [handle] = await window.showOpenFilePicker!({ types: [FLICK_FILE_TYPE] })
      const file = await handle.getFile()
      const text = await file.text()
      const project = JSON.parse(text) as Project
      if (!validateProject(project)) {
        alert('Invalid project file.')
        return null
      }
      currentFileHandle = handle
      currentFileName = handle.name
      return { project, name: handle.name }
    } catch {
      // User cancelled or error
      return null
    }
  }

  // Fallback: hidden file input
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.flick,.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) { resolve(null); return }
      try {
        const text = await file.text()
        const project = JSON.parse(text) as Project
        if (!validateProject(project)) {
          alert('Invalid project file.')
          resolve(null)
          return
        }
        currentFileHandle = null
        currentFileName = file.name
        resolve({ project, name: file.name })
      } catch {
        alert('Failed to read project file.')
        resolve(null)
      }
    }
    input.click()
  })
}

export async function saveProject(project: Project): Promise<string | null> {
  if (currentFileHandle) {
    try {
      const writable = await currentFileHandle.createWritable()
      await writable.write(JSON.stringify(project, null, 2))
      await writable.close()
      return currentFileName
    } catch {
      // Handle may have been invalidated; fall through to Save As
    }
  }
  return saveProjectAs(project)
}

export async function saveProjectAs(project: Project): Promise<string | null> {
  const json = JSON.stringify(project, null, 2)

  if (hasFileSystemAccess) {
    try {
      const handle = await window.showSaveFilePicker!({
        suggestedName: currentFileName || 'untitled.flick',
        types: [FLICK_FILE_TYPE],
      })
      const writable = await handle.createWritable()
      await writable.write(json)
      await writable.close()
      currentFileHandle = handle
      currentFileName = handle.name
      return handle.name
    } catch {
      return null
    }
  }

  // Fallback: prompt for filename, then download via blob
  const suggested = currentFileName || 'untitled.flick'
  const filename = prompt('Save project as:', suggested)
  if (!filename) return null
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
  currentFileName = filename
  return filename
}

export async function exportSvgSequence(project: Project): Promise<void> {
  if (!window.showDirectoryPicker) {
    alert('SVG sequence export requires a browser with File System Access API support (Chrome or Edge).')
    return
  }

  try {
    const dirHandle = await window.showDirectoryPicker!({ mode: 'readwrite' })
    const totalDigits = String(project.totalFrames).length

    for (let f = 1; f <= project.totalFrames; f++) {
      const svg = renderFrameToSvg(project, f)
      const name = `frame_${String(f).padStart(totalDigits, '0')}.svg`
      const fileHandle = await dirHandle.getFileHandle(name, { create: true })
      const writable = await fileHandle.createWritable()
      await writable.write(svg)
      await writable.close()
    }

    alert(`Exported ${project.totalFrames} SVG frames.`)
  } catch {
    // User cancelled
  }
}

// ── Validation ──

function validateProject(p: unknown): p is Project {
  if (!p || typeof p !== 'object') return false
  const obj = p as Record<string, unknown>
  return (
    typeof obj.frameRate === 'number' &&
    typeof obj.width === 'number' &&
    typeof obj.height === 'number' &&
    typeof obj.totalFrames === 'number' &&
    Array.isArray(obj.layers)
  )
}
