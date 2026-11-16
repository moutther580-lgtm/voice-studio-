import { handleVercelNode, type NodeLikeReq, type NodeLikeRes } from './_vercel.js';

export default async function handler(req: NodeLikeReq, res: NodeLikeRes): Promise<void> {
  return handleVercelNode(req, res);
}
