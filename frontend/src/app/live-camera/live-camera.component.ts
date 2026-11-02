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
  templateUrl: './live-camera.component.html',
  styleUrl: './live-camera.component.scss'
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
