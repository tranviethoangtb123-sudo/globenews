// Netlify Function：触发 GitHub Actions 重新抓取新闻（云端刷新）
// 环境变量：GH_DISPATCH_TOKEN（GitHub 令牌，在 Netlify 站点环境变量里配置）
exports.handler = async (event) => {
  const token = process.env.GH_DISPATCH_TOKEN;
  if (!token) {
    return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ ok: false, msg: 'missing token' }) };
  }
  try {
    const r = await fetch('https://api.github.com/repos/tranviethoangtb123-sudo/globenews/actions/workflows/globenews.yml/dispatches', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'User-Agent': 'globenews-refresh',
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ref: 'main' })
    });
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: r.status === 204, status: r.status })
    };
  } catch (e) {
    return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ ok: false, msg: String(e.message || e) }) };
  }
};
