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

  // Phase 2: Dynamic Physical Challenge Token & Instruction
  challengeToken: string = '';
  challengeInstruction: string = '';
  challengeAction: string = '';
  challengeCode: string = '';

  // Geolocation tracking
  currentLocation: string | null = null;
  isLocationAcquiring: boolean = false;
  locationError: string | null = null;

  constructor(private http: HttpClient) {}

  ngAfterViewInit() {
    this.startCamera();
    this.fetchChallengeToken();
    this.requestLocationFix();
  }

  fetchChallengeToken() {
    if (!this.projectId) return;
    this.http.get<any>(`${API_BASE_URL}/api/projects/${this.projectId}/challenge-token`)
      .subscribe({
        next: (res) => {
          this.challengeToken = res.token || '';
          this.challengeInstruction = res.instruction || res.action || '';
          this.challengeAction = res.action || '';
          this.challengeCode = res.code || '';
        },
        error: (err) => {
          console.warn('Could not fetch physical challenge token:', err);
        }
      });
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
    this.requestLocationFix();
  }

  requestLocationFix() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      this.locationError = 'GPS unavailable';
      return;
    }
    this.isLocationAcquiring = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.isLocationAcquiring = false;
        this.currentLocation = `${pos.coords.latitude.toFixed(6)},${pos.coords.longitude.toFixed(6)}`;
      },
      (err) => {
        this.isLocationAcquiring = false;
        this.locationError = err.message || 'GPS signal unavailable';
      },
      { timeout: 6000, enableHighAccuracy: true, maximumAge: 30000 }
    );
  }

  private async fetchCoordinates(): Promise<string | null> {
    if (this.currentLocation) return this.currentLocation;
    return new Promise((resolve) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
      const timer = setTimeout(() => resolve(null), 2500);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(timer);
          const coords = `${pos.coords.latitude.toFixed(6)},${pos.coords.longitude.toFixed(6)}`;
          this.currentLocation = coords;
          resolve(coords);
        },
        () => {
          clearTimeout(timer);
          resolve(null);
        },
        { timeout: 2500, enableHighAccuracy: true, maximumAge: 30000 }
      );
    });
  }

  async confirmAndUploadBatch() {
    if (!this.projectId || this.capturedBlobs.length === 0) return;
    this.state = 'uploading';

    const locationCoords = this.currentLocation || await this.fetchCoordinates();

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
    if (this.challengeToken) {
      formData.append('challenge_token', this.challengeToken);
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
