'use client';

import { useState, useRef, useCallback } from 'react';
import { ImagePlus, X, Upload, AlertCircle, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '@/lib/api';
import { compressImage } from '@/lib/compress-image';

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB raw limit before compression
const MAX_FILES = 10;

interface ImageUploaderProps {
  value: string[];
  onChange: (urls: string[]) => void;
  error?: string;
}

interface FileEntry {
  id: string;
  previewUrl: string;   // object URL for instant preview
  finalUrl?: string;    // returned from server after upload
  status: 'uploading' | 'done' | 'error';
  errorMsg?: string;
}

export default function ImageUploader({ value, onChange, error }: ImageUploaderProps) {
  const [entries, setEntries] = useState<FileEntry[]>(() =>
    value.map(url => ({ id: url, previewUrl: url, finalUrl: url, status: 'done' }))
  );
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadFile = useCallback(async (file: File) => {
    // nosemgrep: ajinabraham.njsscan.crypto.crypto_node.node_insecure_random_generator
    // Math.random() is intentional here — `id` is a UI key for the preview list,
    // never used as a token, secret, or anything security-sensitive.
    const id = `${Date.now()}-${Math.random()}`;
    const previewUrl = URL.createObjectURL(file);

    // Validate
    if (!ACCEPTED.includes(file.type)) {
      setEntries(prev => [...prev, { id, previewUrl, status: 'error', errorMsg: 'Invalid file type. Use JPG, PNG, WebP, or GIF.' }]);
      return;
    }
    if (file.size > MAX_SIZE) {
      setEntries(prev => [...prev, { id, previewUrl, status: 'error', errorMsg: 'File too large. Max 5 MB.' }]);
      return;
    }

    setEntries(prev => [...prev, { id, previewUrl, status: 'uploading' }]);

    try {
      const compressed = await compressImage(file);
      const formData = new FormData();
      formData.append('file', compressed);
      const res = await api.post('/vendor/upload-image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const finalUrl: string = res.data.url;

      setEntries(prev =>
        prev.map(e => e.id === id ? { ...e, finalUrl, status: 'done' } : e)
      );
      onChange([...value, finalUrl]);
    } catch {
      setEntries(prev =>
        prev.map(e => e.id === id ? { ...e, status: 'error', errorMsg: 'Upload failed. Try again.' } : e)
      );
    }
  }, [value, onChange]);

  const processFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files);
    const remaining = MAX_FILES - entries.filter(e => e.status !== 'error').length;
    arr.slice(0, remaining).forEach(uploadFile);
  }, [entries, uploadFile]);

  const removeEntry = useCallback((id: string) => {
    let nextUrls: string[] = [];
    setEntries(prev => {
      const entry = prev.find(e => e.id === id);
      if (entry?.previewUrl.startsWith('blob:')) URL.revokeObjectURL(entry.previewUrl);
      const next = prev.filter(e => e.id !== id);
      nextUrls = next.filter(e => e.status === 'done' && e.finalUrl).map(e => e.finalUrl!);
      return next;
    });
    // Call onChange outside the setState updater to avoid updating parent during render
    queueMicrotask(() => onChange(nextUrls));
  }, [onChange]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    processFiles(e.dataTransfer.files);
  }, [processFiles]);

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragging(true); };
  const onDragLeave = () => setDragging(false);

  const hasImages = entries.length > 0;

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => inputRef.current?.click()}
        className={`relative cursor-pointer rounded-2xl border-2 border-dashed transition-all duration-200 p-6 flex flex-col items-center justify-center gap-3 text-center select-none
          ${dragging
            ? 'border-teal-400 bg-teal-50/10 dark:bg-teal-900/10 scale-[1.01]'
            : error
              ? 'border-red-400 dark:border-red-500 bg-red-50/5'
              : 'border-gray-200 dark:border-slate-700 hover:border-teal-400 dark:hover:border-teal-500 hover:bg-teal-50/5 dark:hover:bg-teal-900/5'
          }`}
      >
        <div className={`p-3 rounded-full transition-colors ${dragging ? 'bg-teal-100 dark:bg-teal-900/40' : 'bg-gray-100 dark:bg-slate-800'}`}>
          <Upload className={`h-6 w-6 ${dragging ? 'text-teal-500' : 'text-gray-400 dark:text-slate-500'}`} />
        </div>
        <div>
          <p className="text-sm font-medium text-gray-700 dark:text-slate-300">
            {dragging ? 'Drop images here' : 'Drag & drop images, or click to browse'}
          </p>
          <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">
            JPG, PNG, WebP, GIF · Max 5 MB per file · Up to {MAX_FILES} images
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED.join(',')}
          multiple
          className="hidden"
          onChange={e => { if (e.target.files) processFiles(e.target.files); e.target.value = ''; }}
          onClick={e => e.stopPropagation()}
        />
      </div>

      {error && (
        <p className="flex items-center gap-1.5 text-xs text-red-500">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}

      {/* Thumbnails */}
      {hasImages && (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
          <AnimatePresence>
            {entries.map((entry, i) => (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.2 }}
                className="relative group aspect-square rounded-xl overflow-hidden border border-gray-200 dark:border-slate-700 bg-gray-100 dark:bg-slate-800"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={entry.previewUrl}
                  alt={`Image ${i + 1}`}
                  className={`w-full h-full object-cover transition-opacity ${entry.status === 'uploading' ? 'opacity-40' : 'opacity-100'}`}
                />

                {/* Uploading overlay */}
                {entry.status === 'uploading' && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                    <Loader2 className="h-6 w-6 text-white animate-spin" />
                  </div>
                )}

                {/* Error overlay */}
                {entry.status === 'error' && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-900/70 p-1">
                    <AlertCircle className="h-5 w-5 text-red-200 mb-1" />
                    <p className="text-[9px] text-red-200 text-center leading-tight">{entry.errorMsg}</p>
                  </div>
                )}

                {/* First image badge */}
                {i === 0 && entry.status === 'done' && (
                  <span className="absolute top-1 inset-s-1 px-1.5 py-0.5 text-[9px] font-bold bg-teal-500 text-white rounded-md">
                    Cover
                  </span>
                )}

                {/* Remove button */}
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); removeEntry(entry.id); }}
                  className="absolute top-1 inset-e-1 p-1 bg-black/60 hover:bg-black/80 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="h-3 w-3" />
                </button>
              </motion.div>
            ))}

            {/* Add more slot */}
            {entries.filter(e => e.status !== 'error').length < MAX_FILES && (
              <motion.button
                key="add-more"
                type="button"
                onClick={() => inputRef.current?.click()}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="aspect-square rounded-xl border-2 border-dashed border-gray-200 dark:border-slate-700 hover:border-teal-400 dark:hover:border-teal-500 flex flex-col items-center justify-center gap-1 text-gray-400 dark:text-slate-500 hover:text-teal-500 transition-colors"
              >
                <ImagePlus className="h-5 w-5" />
                <span className="text-[10px]">Add more</span>
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
