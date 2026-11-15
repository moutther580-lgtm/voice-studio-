import { forwardToHandler } from './_vercel';

export async function GET(request: Request): Promise<Response> {
  return forwardToHandler(request);
}
