/**
 * PATH Y: Doctor UUID Determination
 *
 * Handles:
 * - Doctor authentication and identification
 * - Session-based identity
 * - Demo/development mode fallback
 * - Multi-tenant isolation
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { EventEmitter } from 'events';

export interface DoctorIdentity {
  id: string;           // UUID
  email: string | null;
  name: string | null;
  specialty: string | null;
  isDemo: boolean;
  isAuthenticated: boolean;
  permissions: DoctorPermissions;
  metadata: DoctorMetadata;
}

export interface DoctorPermissions {
  canRecord: boolean;
  canAccessPatients: boolean;
  canUseAutopilot: boolean;
  canExport: boolean;
  maxConcurrentSessions: number;
}

export interface DoctorMetadata {
  lastLoginAt: number | null;
  lastActivityAt: number | null;
  totalTranscripts: number;
  createdAt: number;
}

export interface AuthToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

// Demo doctor for development
const DEMO_DOCTOR: DoctorIdentity = {
  id: '00000000-0000-0000-0000-000000000000',
  email: 'demo@assistmd.local',
  name: 'Demo Doctor',
  specialty: 'General Practice',
  isDemo: true,
  isAuthenticated: false,
  permissions: {
    canRecord: true,
    canAccessPatients: true,
    canUseAutopilot: true,
    canExport: false,
    maxConcurrentSessions: 1
  },
  metadata: {
    lastLoginAt: null,
    lastActivityAt: null,
    totalTranscripts: 0,
    createdAt: Date.now()
  }
};

export class DoctorIdentityManager extends EventEmitter {
  private supabase: SupabaseClient | null;
  private currentDoctor: DoctorIdentity | null = null;
  private authToken: AuthToken | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private isDemoMode: boolean;

  constructor(supabase: SupabaseClient | null, options?: { demoMode?: boolean }) {
    super();
    this.supabase = supabase;
    this.isDemoMode = options?.demoMode ?? !supabase;

    if (this.isDemoMode) {
      this.setDemoDoctor();
    }
  }

  // ─────────────────────────────────────────────
  // Authentication
  // ─────────────────────────────────────────────

  public async authenticate(email: string, password: string): Promise<DoctorIdentity | null> {
    if (!this.supabase) {
      this.emit('auth:error', new Error('Supabase not configured'));
      return this.setDemoDoctor();
    }

    try {
      const { data, error } = await this.supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      if (data.session) {
        this.authToken = {
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
          expiresAt: Date.now() + (data.session.expires_in || 3600) * 1000
        };

        this.scheduleTokenRefresh();
      }

      const doctor = await this.loadDoctorProfile(data.user?.id);
      this.currentDoctor = doctor;

      this.emit('auth:success', doctor);
      return doctor;
    } catch (err) {
      this.emit('auth:error', err);
      return null;
    }
  }

  public async authenticateWithToken(accessToken: string): Promise<DoctorIdentity | null> {
    if (!this.supabase) {
      return this.setDemoDoctor();
    }

    try {
      const { data, error } = await this.supabase.auth.getUser(accessToken);

      if (error) throw error;

      this.authToken = {
        accessToken,
        expiresAt: Date.now() + 3600 * 1000 // Assume 1 hour
      };

      const doctor = await this.loadDoctorProfile(data.user?.id);
      this.currentDoctor = doctor;

      this.emit('auth:success', doctor);
      return doctor;
    } catch (err) {
      this.emit('auth:error', err);
      return null;
    }
  }

  public async logout(): Promise<void> {
    if (this.supabase) {
      try {
        await this.supabase.auth.signOut();
      } catch (err) {
        // Ignore signout errors
      }
    }

    this.clearTokenRefresh();
    this.currentDoctor = null;
    this.authToken = null;

    this.emit('auth:logout');
  }

  // ─────────────────────────────────────────────
  // Token Management
  // ─────────────────────────────────────────────

  private scheduleTokenRefresh(): void {
    this.clearTokenRefresh();

    if (!this.authToken) return;

    const refreshIn = this.authToken.expiresAt - Date.now() - 60000; // 1 min before expiry

    if (refreshIn > 0) {
      this.refreshTimer = setTimeout(async () => {
        await this.refreshToken();
      }, refreshIn);
    }
  }

  private async refreshToken(): Promise<boolean> {
    if (!this.supabase || !this.authToken?.refreshToken) {
      return false;
    }

    try {
      const { data, error } = await this.supabase.auth.refreshSession({
        refresh_token: this.authToken.refreshToken
      });

      if (error) throw error;

      if (data.session) {
        this.authToken = {
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
          expiresAt: Date.now() + (data.session.expires_in || 3600) * 1000
        };

        this.scheduleTokenRefresh();
        this.emit('token:refreshed');
        return true;
      }

      return false;
    } catch (err) {
      this.emit('token:refresh_error', err);
      return false;
    }
  }

  private clearTokenRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  // ─────────────────────────────────────────────
  // Profile Loading
  // ─────────────────────────────────────────────

  private async loadDoctorProfile(userId?: string): Promise<DoctorIdentity> {
    if (!userId || !this.supabase) {
      return this.setDemoDoctor();
    }

    try {
      // Try to load from doctors table or users table
      const { data: profile } = await this.supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      // Count transcripts
      const { count } = await this.supabase
        .from('transcripts2')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);

      return {
        id: userId,
        email: profile?.email || null,
        name: profile?.full_name || profile?.name || null,
        specialty: profile?.specialty || null,
        isDemo: false,
        isAuthenticated: true,
        permissions: this.derivePermissions(profile),
        metadata: {
          lastLoginAt: Date.now(),
          lastActivityAt: Date.now(),
          totalTranscripts: count || 0,
          createdAt: profile?.created_at ? new Date(profile.created_at).getTime() : Date.now()
        }
      };
    } catch (err) {
      // Fallback to basic identity
      return {
        id: userId,
        email: null,
        name: null,
        specialty: null,
        isDemo: false,
        isAuthenticated: true,
        permissions: this.getDefaultPermissions(),
        metadata: {
          lastLoginAt: Date.now(),
          lastActivityAt: Date.now(),
          totalTranscripts: 0,
          createdAt: Date.now()
        }
      };
    }
  }

  private derivePermissions(profile: Record<string, unknown> | null): DoctorPermissions {
    // Could be derived from profile.role, profile.subscription, etc.
    return {
      canRecord: true,
      canAccessPatients: true,
      canUseAutopilot: profile?.subscription !== 'free',
      canExport: profile?.subscription === 'pro' || profile?.subscription === 'enterprise',
      maxConcurrentSessions: profile?.subscription === 'enterprise' ? 5 : 2
    };
  }

  private getDefaultPermissions(): DoctorPermissions {
    return {
      canRecord: true,
      canAccessPatients: true,
      canUseAutopilot: true,
      canExport: false,
      maxConcurrentSessions: 2
    };
  }

  // ─────────────────────────────────────────────
  // Demo Mode
  // ─────────────────────────────────────────────

  private setDemoDoctor(): DoctorIdentity {
    this.currentDoctor = { ...DEMO_DOCTOR };
    this.isDemoMode = true;
    this.emit('demo:active');
    return this.currentDoctor;
  }

  public enableDemoMode(): DoctorIdentity {
    return this.setDemoDoctor();
  }

  public isInDemoMode(): boolean {
    return this.isDemoMode || this.currentDoctor?.isDemo === true;
  }

  // ─────────────────────────────────────────────
  // Identity Access
  // ─────────────────────────────────────────────

  public getCurrentDoctor(): DoctorIdentity | null {
    return this.currentDoctor;
  }

  public getDoctorId(): string | null {
    return this.currentDoctor?.id || null;
  }

  public isAuthenticated(): boolean {
    return this.currentDoctor?.isAuthenticated === true;
  }

  public hasPermission(permission: keyof DoctorPermissions): boolean {
    if (!this.currentDoctor) return false;
    return !!this.currentDoctor.permissions[permission];
  }

  public getAccessToken(): string | null {
    return this.authToken?.accessToken || null;
  }

  // ─────────────────────────────────────────────
  // Activity Tracking
  // ─────────────────────────────────────────────

  public recordActivity(): void {
    if (this.currentDoctor?.metadata) {
      this.currentDoctor.metadata.lastActivityAt = Date.now();
    }
  }

  public incrementTranscriptCount(): void {
    if (this.currentDoctor?.metadata) {
      this.currentDoctor.metadata.totalTranscripts++;
    }
  }

  // ─────────────────────────────────────────────
  // Resolution Helpers
  // ─────────────────────────────────────────────

  public async resolveFromRequest(headers: Record<string, string | undefined>): Promise<DoctorIdentity> {
    // Check for Authorization header
    const authHeader = headers['authorization'] || headers['Authorization'];

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const doctor = await this.authenticateWithToken(token);
      if (doctor) return doctor;
    }

    // Check for X-Doctor-Id header (for development)
    const doctorId = headers['x-doctor-id'];
    if (doctorId && this.isDemoMode) {
      return {
        ...DEMO_DOCTOR,
        id: doctorId
      };
    }

    // Fall back to current doctor or demo
    return this.currentDoctor || this.setDemoDoctor();
  }

  public async resolveFromWebSocket(params: {
    token?: string;
    doctorId?: string;
  }): Promise<DoctorIdentity> {
    if (params.token) {
      const doctor = await this.authenticateWithToken(params.token);
      if (doctor) return doctor;
    }

    if (params.doctorId && this.isDemoMode) {
      return {
        ...DEMO_DOCTOR,
        id: params.doctorId
      };
    }

    return this.currentDoctor || this.setDemoDoctor();
  }

  // ─────────────────────────────────────────────
  // Cleanup
  // ─────────────────────────────────────────────

  public destroy(): void {
    this.clearTokenRefresh();
    this.currentDoctor = null;
    this.authToken = null;
  }
}

export default DoctorIdentityManager;
