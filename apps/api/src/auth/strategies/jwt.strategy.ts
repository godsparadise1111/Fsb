import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

const jwtSecret = process.env.JWT_SECRET ?? (process.env.NODE_ENV === 'production' ? '' : 'development-only-change-this-secret');
if (jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be configured with at least 32 characters before starting F-S in production.');
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), ignoreExpiration: false, secretOrKey: jwtSecret });
  }
  validate(payload: { sub: string; username: string; email: string }) {
    return { sub: payload.sub, username: payload.username, email: payload.email };
  }
}