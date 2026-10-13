import 'server-only';
import { cookies } from 'next/headers';
import { isValidTz } from '@/lib/shared/format';

export const TZ_COOKIE = 'tz';

// Часовой пояс пользователя: браузер сообщает его в cookie при каждом открытии.
export async function getTz(): Promise<string> {
  const jar = await cookies();
  const tz = jar.get(TZ_COOKIE)?.value;
  if (tz && isValidTz(tz)) return tz;
  return process.env.DEFAULT_TIMEZONE || 'Asia/Almaty';
}
