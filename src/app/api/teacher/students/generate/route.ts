import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    { message: 'Student login credentials are no longer required. Share the classroom code instead.' },
    { status: 410 },
  );
}
