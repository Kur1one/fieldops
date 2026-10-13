import { NextResponse, type NextRequest } from 'next/server';
import { destroySession } from '@/lib/server/auth';

export async function POST(req: NextRequest) {
  await destroySession();
  return NextResponse.redirect(new URL('/login', process.env.APP_URL || req.nextUrl.origin), 303);
}
