import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHealth(): string {
    return 'AL Jadwal API is healthy 🚀';
  }
}
