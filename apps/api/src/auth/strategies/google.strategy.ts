import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile, VerifyCallback } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';

export interface GoogleProfile {
  googleId: string;
  email: string;
  fullName: string;
  picture: string | null;
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(configService: ConfigService) {
    const clientID = configService.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = configService.get<string>('GOOGLE_CLIENT_SECRET');

    if (!clientID || !clientSecret) {
      throw new Error('FATAL: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set.');
    }

    super({
      clientID,
      clientSecret,
      callbackURL: configService.getOrThrow<string>('GOOGLE_CALLBACK_URL'),
      scope: ['email', 'profile'],
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): Promise<void> {
    const emailEntry = profile.emails?.[0] as
      | { value?: string; verified?: boolean | string }
      | undefined;
    const email = emailEntry?.value;

    if (!email) {
      return done(new Error('No email returned from Google'), undefined);
    }

    // Only trust the address if Google itself says it's verified. Without this,
    // a Google account whose email is unverified could be used to claim or
    // auto-link a Jadwal account at that address (the OAuth-link path trusts
    // this email). Google's raw userinfo carries `email_verified`; passport also
    // surfaces a per-address `verified` flag — accept either.
    const json = profile._json as { email_verified?: boolean } | undefined;
    const emailVerified =
      json?.email_verified === true ||
      emailEntry?.verified === true ||
      emailEntry?.verified === 'true';
    if (!emailVerified) {
      return done(new Error('Google account email is not verified'), undefined);
    }

    const user: GoogleProfile = {
      googleId: profile.id,
      email,
      fullName: profile.displayName || `${profile.name?.givenName ?? ''} ${profile.name?.familyName ?? ''}`.trim(),
      picture: profile.photos?.[0]?.value ?? null,
    };

    done(null, user);
  }
}
