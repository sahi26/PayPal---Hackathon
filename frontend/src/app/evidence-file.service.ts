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

    const match = filePath.replace(/^\/+/, '').match(/^uploads\/([^/]+)$/);
    if (!match || match[1].includes('\\')) {
      return throwError(() => new Error('Unsupported evidence file path.'));
    }

    const cachedUrl = this.fileUrls.get(filePath);
    if (cachedUrl) {
      return cachedUrl;
    }

    const fileUrl = this.http
      .get(`${API_BASE_URL}/api/evidence/download/${encodeURIComponent(match[1])}`, {
        responseType: 'blob'
      })
      .pipe(
        map(file => {
          const objectUrl = URL.createObjectURL(file);
          this.objectUrls.add(objectUrl);
          return objectUrl;
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
        catchError(error => {
          this.fileUrls.delete(filePath);
          return throwError(() => error);
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
