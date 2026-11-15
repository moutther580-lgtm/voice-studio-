import { forwardToHandler } from './_vercel';

export async function POST(request: Request): Promise<Response> {
  return forwardToHandler(request);
}
