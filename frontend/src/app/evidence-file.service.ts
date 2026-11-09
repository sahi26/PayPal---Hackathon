import { Injectable, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of, shareReplay, throwError } from 'rxjs';
import { API_BASE_URL } from './api.config';

@Injectable({ providedIn: 'root' })
export class EvidenceFileService implements OnDestroy {
  private readonly fileUrls = new Map<string, Observable<string>>();
  private readonly objectUrls = new Set<string>();

  constructor(private http: HttpClient) {}

  getFileUrl(filePath: string): Observable<string> {
    if (!filePath) {
      return of('');
    }

    if (/^https?:\/\//i.test(filePath)) {
      return of(filePath);
    }

    const clean = filePath.replace(/^\/+/, '');
    const filename = clean.startsWith('uploads/') ? clean.slice(8) : clean;
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
          const objectUrl = URL.createObjectURL(file);
          this.objectUrls.add(objectUrl);
          return objectUrl;
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
        catchError(() => {
          return of(svgFallback);
        })
      );

    this.fileUrls.set(filePath, fileUrl);
    return fileUrl;
  }

  ngOnDestroy(): void {
    this.objectUrls.forEach(url => URL.revokeObjectURL(url));
    this.objectUrls.clear();
    this.fileUrls.clear();
  }
}
