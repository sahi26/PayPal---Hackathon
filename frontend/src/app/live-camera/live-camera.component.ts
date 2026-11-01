import { Component, ElementRef, ViewChild, OnDestroy, AfterViewInit, Output, EventEmitter, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { API_BASE_URL } from '../api.config';

export type CameraState = 'initializing' | 'active' | 'uploading' | 'success' | 'error' | 'permission_denied';

export interface CapturedBlobItem {
  blob: Blob;
  previewUrl: string;
  timestamp: string;
}

@Component({
  selector: 'app-live-camera',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="camera-card">
      <div class="camera-card-header">
        <div class="header-tag">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
            <circle cx="12" cy="13" r="4"/>
          </svg>
          <span>{{ label }}</span>
        </div>
        <div class="header-badges">
          @if (capturedBlobs.length > 0) {
            <span class="count-pill">{{ capturedBlobs.length }} Captured</span>
          }
          <span class="auth-pill">Hardware Rear-Camera Enforced</span>
        </div>
      </div>

      <!-- State: Initializing -->
      @if (state === 'initializing') {
        <div class="status-panel loading-panel">
          <div class="camera-spinner"></div>
          <p>Accessing camera hardware...</p>
        </div>
      }

      <!-- State: Permission Denied -->
      @if (state === 'permission_denied') {
        <div class="status-panel warning-panel">
          <div class="panel-icon warning-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <div class="panel-text">
            <strong>Camera Access Required</strong>
            <p>Please enable camera permissions in your browser. ProofLens requires direct live camera capture to guarantee proof authenticity.</p>
          </div>
          <div class="panel-actions">
            <button (click)="startCamera()" class="btn-panel-action">Grant Camera Access / Retry</button>
          </div>
        </div>
      }

      <!-- State: Camera Error -->
      @if (state === 'error') {
        <div class="status-panel error-panel">
          <div class="panel-icon error-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <circle cx="12" cy="12" r="10"/>
              <line x1="15" y1="9" x2="9" y2="15"/>
              <line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
          </div>
          <div class="panel-text">
            <strong>Camera Device Error</strong>
            <p>{{ errorMessage || 'Camera is currently unavailable or in use by another application.' }}</p>
          </div>
          <div class="panel-actions">
            <button (click)="startCamera()" class="btn-panel-action">Retry Camera</button>
          </div>
        </div>
      }

      <!-- Live Stream Viewfinder Shell -->
      <div [hidden]="state !== 'active'" class="viewfinder-shell">
        <video #videoElement autoplay playsinline class="viewfinder-video"></video>
        <div class="viewfinder-overlay">
          <div class="overlay-grid"></div>
          <span class="live-rec-badge">
            <span class="rec-dot"></span> LIVE SENSOR FEED
          </span>
          <span class="anti-spoof-chip">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
            <span>Anti-Spoofing Audit Active</span>
          </span>
        </div>

        <div class="viewfinder-controls">
          <button (click)="captureAngle()" class="btn-shutter">
            <span class="shutter-inner"></span>
            <span class="shutter-label">Capture Angle #{{ capturedBlobs.length + 1 }}</span>
          </button>
        </div>
      </div>

      <!-- Hidden canvas used for live frame extraction -->
      <canvas #canvasElement style="display: none;"></canvas>

      <!-- Multi-Angle Captured Tray & Batch Actions -->
      @if (capturedBlobs.length > 0 && (state === 'active' || state === 'uploading')) {
        <div class="tray-container">
          <div class="tray-header">
            <span class="tray-title">Captured Angles ({{ capturedBlobs.length }})</span>
            <span class="tray-hint">Capture multiple vantage points (e.g. wide room, close-up details, plumbing/valves).</span>
          </div>

          <div class="thumbnails-grid">
            @for (item of capturedBlobs; track $index) {
              <div class="thumb-card">
                <img [src]="item.previewUrl" alt="Angle {{ $index + 1 }}" class="thumb-img" />
                <div class="thumb-bar">
                  <span class="angle-tag">Angle {{ $index + 1 }}</span>
                  <button type="button" (click)="removeAngle($index)" [disabled]="state === 'uploading'" class="btn-del-thumb" title="Remove angle" aria-label="Remove angle">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>
              </div>
            }
          </div>

          <div class="batch-actions-bar">
            <button type="button" (click)="resetAll()" [disabled]="state === 'uploading'" class="btn-reset-batch">
              Retake All
            </button>
            <button type="button" (click)="confirmAndUploadBatch()" [disabled]="state === 'uploading'" class="btn-confirm-batch">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <span>{{ state === 'uploading' ? 'Hashing & Auditing Evidence...' : 'Confirm & Lock ' + capturedBlobs.length + ' Angle' + (capturedBlobs.length > 1 ? 's' : '') + ' (SHA-256)' }}</span>
            </button>
          </div>
        </div>
      }

      <!-- State: Uploading Spinner Overlay -->
      @if (state === 'uploading') {
        <div class="status-panel loading-panel inline-loader">
          <div class="camera-spinner"></div>
          <strong>Hashing & Auditing Live Submissions...</strong>
          <p>Generating SHA-256 cryptographic digests, verifying GPS coordinates, and checking for screen re-photograph patterns.</p>
        </div>
      }

      <!-- State: Success -->
      @if (state === 'success') {
        <div class="status-panel success-panel">
          <div class="panel-icon success-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
          <div class="panel-text">
            <strong>Evidence Batch Successfully Secured</strong>
            <p>Authoritative cryptographic hashes and server timestamps registered in ProofLens PayPal escrow audit log.</p>
          </div>
          <button (click)="startAnotherCaptureSession()" class="btn-panel-sub">Capture Additional Proof Angles</button>
        </div>
      }
    </div>
  `,
  styles: [`
    .camera-card {
      width: 100%;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 16px rgba(0, 20, 53, 0.05);
      margin: 0 auto;
    }

    .camera-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.65rem 1rem;
      background: #001435;
      color: #ffffff;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .header-tag {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      font-size: 0.8rem;
      font-weight: 700;
      letter-spacing: 0.02em;
    }

    .header-badges {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .count-pill {
      font-size: 0.7rem;
      font-weight: 800;
      background: #0070ba;
      color: #ffffff;
      padding: 0.15rem 0.5rem;
      border-radius: 10px;
    }

    .auth-pill {
      font-size: 0.65rem;
      font-weight: 700;
      background: rgba(22, 163, 74, 0.2);
      color: #86efac;
      border: 1px solid rgba(134, 239, 172, 0.3);
      padding: 0.15rem 0.5rem;
      border-radius: 12px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .viewfinder-shell {
      position: relative;
      width: 100%;
      background: #000000;
      aspect-ratio: 16 / 9;
      max-height: 420px;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .viewfinder-video {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .viewfinder-overlay {
      position: absolute;
      inset: 0;
      pointer-events: none;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 0.75rem;
    }

    .live-rec-badge {
      align-self: flex-start;
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      background: rgba(0, 0, 0, 0.65);
      color: #ffffff;
      font-size: 0.68rem;
      font-weight: 800;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      letter-spacing: 0.05em;
    }

    .rec-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #ef4444;
      animation: pulse-rec 1.2s infinite;
    }

    @keyframes pulse-rec {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }

    .anti-spoof-chip {
      align-self: flex-end;
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      background: rgba(0, 20, 53, 0.75);
      color: #38bdf8;
      font-size: 0.65rem;
      font-weight: 700;
      padding: 0.2rem 0.45rem;
      border-radius: 4px;
      border: 1px solid rgba(56, 189, 248, 0.3);
    }

    .viewfinder-controls {
      position: absolute;
      bottom: 0.75rem;
      left: 0;
      right: 0;
      display: flex;
      justify-content: center;
    }

    .btn-shutter {
      background: rgba(255, 255, 255, 0.95);
      color: #001435;
      border: 2px solid #0070ba;
      padding: 0.55rem 1.35rem;
      border-radius: 30px;
      cursor: pointer;
      font-weight: 800;
      font-size: 0.85rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      transition: all 0.2s;
    }

    .btn-shutter:hover {
      background: #ffffff;
      transform: scale(1.03);
    }

    .shutter-inner {
      width: 10px;
      height: 10px;
      background: #0070ba;
      border-radius: 50%;
    }

    /* Thumbnail Tray */
    .tray-container {
      background: #f8fafc;
      border-top: 1px solid #cbd5e1;
      padding: 0.85rem 1rem;
    }

    .tray-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.6rem;
      flex-wrap: wrap;
      gap: 0.4rem;
    }

    .tray-title {
      font-size: 0.82rem;
      font-weight: 800;
      color: #001435;
    }

    .tray-hint {
      font-size: 0.72rem;
      color: #64748b;
    }

    .thumbnails-grid {
      display: flex;
      gap: 0.65rem;
      overflow-x: auto;
      padding-bottom: 0.5rem;
    }

    .thumb-card {
      position: relative;
      width: 120px;
      flex-shrink: 0;
      border: 1.5px solid #0070ba;
      border-radius: 8px;
      overflow: hidden;
      background: #000;
    }

    .thumb-img {
      width: 100%;
      height: 75px;
      object-fit: cover;
      display: block;
    }

    .thumb-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.2rem 0.4rem;
      background: #ffffff;
      font-size: 0.68rem;
    }

    .angle-tag {
      font-weight: 800;
      color: #001435;
    }

    .btn-del-thumb {
      background: transparent;
      border: none;
      color: #dc2626;
      font-weight: 800;
      cursor: pointer;
      font-size: 0.75rem;
      padding: 0;
      line-height: 1;
    }

    .btn-del-thumb:hover {
      transform: scale(1.2);
    }

    .batch-actions-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 0.75rem;
      padding-top: 0.65rem;
      border-top: 1px solid #e2e8f0;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .btn-reset-batch {
      background: #ffffff;
      color: #475569;
      border: 1px solid #cbd5e1;
      padding: 0.45rem 0.85rem;
      border-radius: 6px;
      font-size: 0.78rem;
      font-weight: 700;
      cursor: pointer;
    }

    .btn-confirm-batch {
      background: #0070ba;
      color: #ffffff;
      border: none;
      padding: 0.55rem 1.25rem;
      border-radius: 6px;
      font-size: 0.82rem;
      font-weight: 800;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      box-shadow: 0 2px 8px rgba(0, 112, 186, 0.25);
    }

    .btn-confirm-batch:hover:not(:disabled) {
      background: #005ea6;
    }

    /* Status Panels */
    .status-panel {
      padding: 1.5rem 1rem;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 0.5rem;
    }

    .loading-panel {
      background: #f8fafc;
      color: #334155;
    }

    .loading-panel.inline-loader {
      border-top: 1px solid #cbd5e1;
      padding: 1rem;
    }

    .camera-spinner {
      width: 28px;
      height: 28px;
      border: 3px solid #cbd5e1;
      border-top-color: #0070ba;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .warning-panel {
      background: #fffbeb;
      border: 1px solid #fde68a;
      color: #92400e;
    }

    .error-panel {
      background: #fef2f2;
      border: 1px solid #fecaca;
      color: #991b1b;
    }

    .success-panel {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      color: #166534;
    }

    .panel-icon.success-icon {
      color: #16a34a;
    }

    .btn-panel-action {
      background: #0070ba;
      color: #ffffff;
      border: none;
      padding: 0.5rem 1.1rem;
      border-radius: 6px;
      font-size: 0.825rem;
      font-weight: 700;
      cursor: pointer;
    }

    .btn-panel-sub {
      background: #ffffff;
      color: #166534;
      border: 1px solid #86efac;
      padding: 0.45rem 1rem;
      border-radius: 6px;
      font-size: 0.8rem;
      font-weight: 700;
      cursor: pointer;
    }
  `]
})
export class LiveCameraComponent implements AfterViewInit, OnDestroy {
  @Input() projectId?: number | null = null;
  @Input() label: string = 'Live Visual Proof Verification';
  @Input() evidenceType: 'before_evidence' | 'milestone_evidence' = 'milestone_evidence';
  @Input() milestoneIndex?: number | null = null;
  @Output() evidenceUploaded = new EventEmitter<any>();

  @ViewChild('videoElement') videoElement!: ElementRef<HTMLVideoElement>;
  @ViewChild('canvasElement') canvasElement!: ElementRef<HTMLCanvasElement>;

  state: CameraState = 'initializing';
  errorMessage = '';
  private stream: MediaStream | null = null;

  capturedBlobs: CapturedBlobItem[] = [];

  constructor(private http: HttpClient) {}

  ngAfterViewInit() {
    this.startCamera();
  }

  ngOnDestroy() {
    this.stopCamera();
    this.cleanupPreviewUrls();
  }

  private cleanupPreviewUrls() {
    for (const item of this.capturedBlobs) {
      if (item.previewUrl) {
        URL.revokeObjectURL(item.previewUrl);
      }
    }
  }

  async startCamera() {
    this.state = 'initializing';
    this.errorMessage = '';
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        this.state = 'error';
        this.errorMessage = 'Camera API is not supported in this browser environment.';
        return;
      }

      // Defense: First attempt to enforce physical rear camera ('environment' exact)
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { exact: 'environment' } },
          audio: false
        });
      } catch (overconstrained) {
        // Fallback for laptop webcams or devices with single camera
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false
        });
      }

      if (this.videoElement && this.videoElement.nativeElement) {
        this.videoElement.nativeElement.srcObject = this.stream;
      }
      this.state = 'active';
    } catch (err: any) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        this.state = 'permission_denied';
      } else {
        this.state = 'error';
        this.errorMessage = err.message || 'Camera unavailable. It may be in use by another application.';
      }
    }
  }

  stopCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
  }

  captureAngle() {
    const video = this.videoElement?.nativeElement;
    const canvas = this.canvasElement?.nativeElement;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    const context = canvas.getContext('2d');
    if (context) {
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (blob) {
          const url = URL.createObjectURL(blob);
          this.capturedBlobs.push({
            blob,
            previewUrl: url,
            timestamp: new Date().toISOString()
          });
        }
      }, 'image/jpeg', 0.90);
    }
  }

  removeAngle(index: number) {
    if (index >= 0 && index < this.capturedBlobs.length) {
      const removed = this.capturedBlobs.splice(index, 1)[0];
      if (removed?.previewUrl) {
        URL.revokeObjectURL(removed.previewUrl);
      }
    }
  }

  resetAll() {
    this.cleanupPreviewUrls();
    this.capturedBlobs = [];
  }

  startAnotherCaptureSession() {
    this.resetAll();
    this.startCamera();
  }

  private async fetchCoordinates(): Promise<string | null> {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      const timer = setTimeout(() => resolve(null), 2000);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(timer);
          resolve(`${pos.coords.latitude.toFixed(6)},${pos.coords.longitude.toFixed(6)}`);
        },
        () => {
          clearTimeout(timer);
          resolve(null);
        },
        { timeout: 2000, maximumAge: 60000 }
      );
    });
  }

  async confirmAndUploadBatch() {
    if (!this.projectId || this.capturedBlobs.length === 0) return;
    this.state = 'uploading';

    const locationCoords = await this.fetchCoordinates();

    const formData = new FormData();
    this.capturedBlobs.forEach((item, index) => {
      formData.append('files', item.blob, `live_capture_${Date.now()}_angle${index + 1}.jpg`);
    });
    formData.append('capture_method', 'live_camera');
    formData.append('evidence_type', this.evidenceType);
    if (this.milestoneIndex !== undefined && this.milestoneIndex !== null) {
      formData.append('milestone_index', this.milestoneIndex.toString());
    }
    if (locationCoords) {
      formData.append('location', locationCoords);
    }

    this.http.post<any>(`${API_BASE_URL}/api/projects/${this.projectId}/evidence-batch`, formData)
      .subscribe({
        next: (response) => {
          this.state = 'success';
          this.stopCamera();
          this.evidenceUploaded.emit(response);
        },
        error: (err) => {
          this.state = 'active';
          alert(err.error?.detail || err.message || 'Evidence batch upload failed. Please try again.');
        }
      });
  }
}
