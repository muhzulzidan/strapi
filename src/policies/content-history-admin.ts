// Version snapshots can contain an article's admin-only body, even after later edits.
// Validate the same active CMS admin session used by Strapi's native admin strategy.
export default async (ctx: any, _config: unknown, { strapi }: any) => {
  try {
    const authorization = ctx.request?.header?.authorization || '';
    const match = /^Bearer\s+(\S+)$/i.exec(authorization);
    const manager = strapi.sessionManager?.('admin');
    if (!match || !manager) return false;
    const result = manager.validateAccessToken(match[1]);
    if (!result.isValid || !(await manager.isSessionActive(result.payload.sessionId))) return false;
    const user = await strapi.db.query('admin::user').findOne({ where: { id: result.payload.userId } });
    if (user?.isActive !== true) return false;
    ctx.state.user = user;
    ctx.state.isAuthenticated = true;
    ctx.set?.('Cache-Control', 'private, no-store');
    return true;
  } catch {
    return false;
  }
};
