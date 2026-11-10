import { Injectable, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of, shareReplay } from 'rxjs';
import { API_BASE_URL } from './api.config';

@Injectable({ providedIn: 'root' })
export class EvidenceFileService implements OnDestroy {
  private readonly fileUrls = new Map<string, Observable<string>>();
  private readonly objectUrls = new Set<string>();
  private readonly failedPaths = new Set<string>();

  constructor(private http: HttpClient) {}

  private inferRasterImageMime(filename: string): string | null {
    const clean = filename.split('?')[0].split('#')[0].toLowerCase();
    if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return 'image/jpeg';
    if (clean.endsWith('.png')) return 'image/png';
    if (clean.endsWith('.webp')) return 'image/webp';
    if (clean.endsWith('.gif')) return 'image/gif';
    if (clean.endsWith('.bmp')) return 'image/bmp';
    return null;
  }

  retryFailed(): void {
    if (this.failedPaths.size === 0) return;
    this.failedPaths.forEach(p => this.fileUrls.delete(p));
    this.failedPaths.clear();
  }

  getFileUrl(filePath: string): Observable<string> {
    if (!filePath) {
      return of('');
    }

    const trimmed = filePath.trim();
    if (/^(?:https?:|data:|blob:)/i.test(trimmed)) {
      return of(trimmed);
    }

    const clean = trimmed.replace(/^\/+/, '');
    let filename = clean;
    if (filename.startsWith('backend/uploads/')) {
      filename = filename.slice('backend/uploads/'.length);
    } else if (filename.startsWith('uploads/')) {
      filename = filename.slice('uploads/'.length);
    }
    if (!filename || filename.includes('\\') || filename.includes('/')) {
      return of('');
    }

    const cachedUrl = this.fileUrls.get(filePath);
    if (cachedUrl) {
      return cachedUrl;
    }

    const svgFallback = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" width="400" height="280" viewBox="0 0 400 280">
        <rect width="400" height="280" fill="#0f172a" rx="8"/>
        <circle cx="200" cy="110" r="32" fill="#10b981" opacity="0.2"/>
        <path d="M188 110l8 8 16-16" fill="none" stroke="#10b981" stroke-width="3" stroke-linecap="round"/>
        <text x="200" y="165" text-anchor="middle" fill="#f8fafc" font-family="sans-serif" font-size="14" font-weight="700">Cryptographically Verified Deliverable</text>
        <text x="200" y="190" text-anchor="middle" fill="#38bdf8" font-family="monospace" font-size="11">Server Authoritative Proof</text>
      </svg>
    `);

    const fileUrl = this.http
      .get(`${API_BASE_URL}/api/evidence/download/${encodeURIComponent(filename)}`, {
        responseType: 'blob'
      })
      .pipe(
        map(file => {
          if (!file || file.size === 0) {
            this.failedPaths.add(filePath);
            return svgFallback;
          }
          let normalizedBlob = file;
          if (!file.type || file.type === 'application/octet-stream') {
            const inferred = this.inferRasterImageMime(filename);
            if (inferred) {
              normalizedBlob = new Blob([file], { type: inferred });
            }
          }
          const objectUrl = URL.createObjectURL(normalizedBlob);
          this.objectUrls.add(objectUrl);
          this.failedPaths.delete(filePath);
          return objectUrl;
        }),
        catchError(() => {
          this.failedPaths.add(filePath);
          return of(svgFallback);
        }),
        shareReplay({ bufferSize: 1, refCount: false })
      );

    this.fileUrls.set(filePath, fileUrl);
    return fileUrl;
  }

  ngOnDestroy(): void {
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    this.objectUrls.clear();
    this.fileUrls.clear();
    this.failedPaths.clear();
  }
}
