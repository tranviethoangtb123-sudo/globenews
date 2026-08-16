// ============================================================
// A-Y 25 板块分类（规则复用邮件推送系统的 src/sectors.js）
// 供 fetch-hot-news.mjs（云端抓取）与 server.js（本地实时）共用
// ============================================================
export const SECTORS = [
  { key: 'A', title: '时政/官方/政策/法规', icon: '🏛️', keywords: ['政府', '国务院', '部委', '政策', '法规', '立法', '白皮书', '新闻发布会', '人事任免', '公务员', '人大', '政协', '政府工作报告', '习近平', '总理', '部长', '当选', '大选', '内阁', 'government', 'policy', 'regulation', 'law', 'legislation', 'white paper', 'press conference', 'cabinet', 'ministry', 'official', 'parliament', 'congress', 'senate', 'election', 'president', 'prime minister', 'minister', 'decree', 'bylaw'] },
  { key: 'B', title: '外交/国际关系/地缘政治/地区冲突', icon: '🌍', keywords: ['外交', '大使', '领事', '会晤', '访问', '峰会', '条约', '联盟', '盟友', '边境', '领土', '争议', '停火', '谈判', '关系', '照会', '建交', '断交', 'diplomacy', 'diplomatic', 'ambassador', 'consul', 'summit', 'treaty', 'alliance', 'ally', 'border', 'territory', 'dispute', 'ceasefire', 'negotiation', 'ties', 'visit', 'meeting', 'embassy'] },
  { key: 'C', title: '军事/国防/战争/军工', icon: '🪖', keywords: ['军队', '军事', '国防', '战争', '战况', '军演', '演习', '武器', '军备', '导弹', '核武', '航母', '战机', '军舰', '士兵', '部队', '进攻', '空袭', '军工', '防务', 'military', 'army', 'navy', 'air force', 'defense', 'war', 'troops', 'soldier', 'missile', 'nuclear weapon', 'aircraft carrier', 'warship', 'drill', 'exercise', 'arsenal', 'offensive', 'strike', 'defense industry', 'arms', 'weapon', 'combat'] },
  { key: 'D', title: '财经/金融/市场/股市/公司/IPO/央行/外汇', icon: '📈', keywords: ['股市', '股票', '债券', '汇率', '央行', '利率', '降息', '加息', '美联储', '欧洲央行', '日本央行', 'IPO', '上市', '并购', '收购', '财报', '基金', '银行', '券商', '保险', '外汇', '资管', 'stocks', 'shares', 'bonds', 'market', 'fed', 'central bank', 'rate', 'rate cut', 'rate hike', 'ipo', 'merger', 'acquisition', 'earnings', 'banking', 'finance', 'forex', 'hedge fund', 'investment', 'trading', 'yield', 'dow', 'nasdaq', '股价', '市值', '巴菲特', '马斯克'] },
  { key: 'E', title: '宏观经济/经济数据/经济政策', icon: '📊', keywords: ['GDP', 'CPI', 'PMI', '通胀', '失业率', '就业', '贸易数据', '财政', '关税', '出口', '进口', '顺差', '逆差', '经济增速', '刺激', '衰退', '增长', '零售', 'gdp', 'inflation', 'unemployment', 'jobs', 'trade', 'deficit', 'surplus', 'fiscal', 'stimulus', 'recession', 'growth', 'industrial production', 'retail sales', '经济数据', '宏观经济', '统计局'] },
  { key: 'F', title: '科技/AI/半导体/互联网', icon: '🤖', keywords: ['人工智能', '大模型', '芯片', '半导体', '算力', '互联网', '平台', '算法', '机器人', '量子', '软件', '硬件', '数据中心', '创业', '融资', 'artificial intelligence', 'ai', 'ai model', 'chip', 'semiconductor', 'computing', 'internet', 'platform', 'app', 'algorithm', 'robot', 'quantum', 'software', 'hardware', 'data center', 'startup', 'funding', 'venture', '云计算', '开源', 'openai', '谷歌', '微软', '苹果', 'meta', '英伟达'] },
  { key: 'G', title: '能源/石油/天然气/新能源', icon: '🛢️', keywords: ['石油', '原油', '天然气', '页岩', 'OPEC', '油价', '光伏', '风电', '核电', '电力', '新能源', '能源', '电价', 'LNG', '煤炭', 'oil', 'crude', 'gas', 'shale', 'opec', 'solar', 'wind', 'nuclear power', 'electricity', 'renewable', 'energy', 'coal', 'lng'] },
  { key: 'H', title: '贵金属/稀土/有色/大宗商品', icon: '🥇', keywords: ['黄金', '白银', '金价', '稀土', '锂', '铜', '铁矿', '铝', '镍', '锌', '期货', '航运运价', '有色', '钢价', '铁矿石', 'gold', 'silver', 'rare earth', 'lithium', 'copper', 'iron ore', 'aluminum', 'nickel', 'zinc', 'commodity', 'freight', 'platinum', 'palladium', '大宗商品', '现货'] },
  { key: 'I', title: '医药/生物科技/医疗健康', icon: '💊', keywords: ['药', '制药', '疫苗', '临床', '审批', 'FDA', '医保', '医疗', '医院', '疾病', '治疗', '生物科技', '器械', 'drug', 'pharma', 'vaccine', 'clinical', 'trial', 'fda', 'ema', 'healthcare', 'hospital', 'disease', 'therapy', 'biotech', 'device', '药企', '新药', '获批'] },
  { key: 'J', title: '人物/观点/深度评论', icon: '✍️', keywords: ['专访', '专栏', '社论', '评论', '观点', '深度', '调查', '分析', '访谈', '智库', '人物', 'interview', 'column', 'editorial', 'opinion', 'analysis', 'commentary', 'profile', 'essay', 'think tank', '书评', '特稿', '深度报道'] },
  { key: 'K', title: '国际综合/突发/快讯', icon: '🌐', keywords: ['突发', '快讯', '最新', '综合', '全球', 'breaking', 'latest', 'update', 'headline', 'world', 'roundup', '速览', '要闻', '国际新闻'] },
  { key: 'L', title: '中东/区域专报', icon: '🕌', keywords: ['中东', '以色列', '巴勒斯坦', '加沙', '伊朗', '叙利亚', '伊拉克', '黎巴嫩', '也门', '沙特', '欧洲', '欧盟', '东南亚', '非洲', '拉美', '中亚', '土耳其', '埃及', 'middle east', 'israel', 'palestine', 'gaza', 'iran', 'syria', 'iraq', 'lebanon', 'yemen', 'saudi', 'europe', 'eu', 'asean', 'africa', 'latin america', 'central asia', 'turkey', 'egypt', '东盟'] },
  { key: 'M', title: '气候/环境/可持续发展', icon: '🌱', keywords: ['气候', '环境', '碳排放', 'ESG', '环保', '绿色金融', '温室', '全球变暖', '巴黎协定', '污染', 'climate', 'environment', 'carbon', 'emissions', 'esg', 'green', 'sustainability', 'pollution', 'climate change', '减排', '碳中和'] },
  { key: 'N', title: '航天/航空/交通物流', icon: '🚀', keywords: ['航天', '火箭', '卫星', '发射', '空间站', '民航', '航空', '机场', '港口', '航运', '物流', '高铁', 'space', 'rocket', 'satellite', 'launch', 'station', 'aviation', 'airline', 'airport', 'port', 'shipping', 'flight', 'logistics', 'spacex'] },
  { key: 'O', title: '汽车/新能源车/出行', icon: '🚗', keywords: ['汽车', '新能源车', '电动车', '特斯拉', '比亚迪', '蔚来', '小鹏', '理想', '电池', '自动驾驶', '充电', '车市', 'auto', 'car', 'ev', 'electric vehicle', 'tesla', 'byd', 'autonomous', 'battery', 'charging', 'vehicle', '销量', '车企', '混合动力'] },
  { key: 'P', title: '房地产/基建/城市化', icon: '🏗️', keywords: ['房地产', '楼市', '房价', '土地', '土拍', '基建', '城投', '地铁', '城镇化', 'real estate', 'property', 'housing', 'land', 'infrastructure', 'construction', 'urban', '棚改', '开发商', '物业'] },
  { key: 'Q', title: '农业/食品/农产品', icon: '🌾', keywords: ['农业', '粮食', '粮价', '农产品', '食品', '食品安全', '养殖', '种业', '化肥', '大豆', '玉米', '小麦', '猪肉', 'agriculture', 'food', 'grain', 'crop', 'farming', 'livestock', 'food safety', 'soybean', 'corn', 'wheat', 'pork', '农贸'] },
  { key: 'R', title: '加密货币/数字资产/区块链', icon: '🪙', keywords: ['比特币', '以太坊', '加密', '区块链', 'Web3', '稳定币', 'NFT', '挖矿', '币安', '交易所', 'bitcoin', 'ethereum', 'crypto', 'blockchain', 'web3', 'stablecoin', 'nft', 'mining', 'binance', 'coinbase', '加密资产'] },
  { key: 'S', title: '法律/监管/合规/制裁', icon: '⚖️', keywords: ['法律', '诉讼', '反垄断', '监管', '合规', '制裁', '出口管制', '禁令', '处罚', '罚款', '调查', '起诉', '法院', '数据合规', 'law', 'lawsuit', 'antitrust', 'regulation', 'compliance', 'sanction', 'export control', 'ban', 'fine', 'penalty', 'probe', 'indictment', 'court', '仲裁', '判决'] },
  { key: 'T', title: '社会/文化/教育/体育/娱乐', icon: '🎭', keywords: ['社会', '文化', '教育', '体育', '娱乐', '电影', '音乐', '艺术', '明星', '奥运', '世界杯', '大学', '学校', '影视', '综艺', 'society', 'culture', 'education', 'sports', 'entertainment', 'film', 'movie', 'music', 'art', 'celebrity', 'olympics', 'university', 'school', '电视剧', '票房'] },
  { key: 'U', title: '数据/报告/智库研究', icon: '📑', keywords: ['报告', '白皮书', '指数', '研报', '排名', '统计', '年鉴', '调查', '智库', 'report', 'index', 'ranking', 'statistics', 'survey', 'research', '论文', '榜单'] },
  { key: 'V', title: '港澳台/区域新闻', icon: '🏙️', keywords: ['香港', '澳门', '台湾', '两岸', '大湾区', '台湾海峡', '港府', '港股', 'hong kong', 'macau', 'taiwan', 'cross-strait', '香港特首', '台当局', '台积电'] },
  { key: 'W', title: '网络安全/隐私/数字治理', icon: '🛡️', keywords: ['网络安全', '黑客', '数据泄露', '隐私', '网络攻击', '漏洞', '勒索', '数字治理', '网络战', 'cybersecurity', 'hacker', 'breach', 'leak', 'privacy', 'cyber attack', 'vulnerability', 'ransomware', 'data protection', '入侵', '钓鱼'] },
  { key: 'X', title: '公共卫生/灾害/应急', icon: '🚑', keywords: ['疫情', '传染', '病毒', '流感', '地震', '洪水', '台风', '火灾', '飓风', '救援', '灾害', '干旱', 'pandemic', 'outbreak', 'virus', 'epidemic', 'earthquake', 'flood', 'typhoon', 'hurricane', 'wildfire', 'disaster', 'relief', 'emergency', '山火', '暴雨'] },
  { key: 'Y', title: '移民/难民/人道主义', icon: '🕊️', keywords: ['移民', '难民', '人道', '援助', '偷渡', '签证', '人口流动', 'migrant', 'refugee', 'humanitarian', 'asylum', 'displacement', '难民营', '遣返'] }
];

export const SECTOR_MAP = Object.fromEntries(SECTORS.map((s) => [s.key, s]));

// 英文关键词用词边界匹配（避免 said/maintain 误中 AI），中文用子串
const asciiCache = new Map();
function matchKw(text, kw) {
  if (!text) return false;
  if (/^[\x00-\x7F]+$/.test(kw)) {
    let re = asciiCache.get(kw);
    if (!re) {
      re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      asciiCache.set(kw, re);
    }
    return re.test(text);
  }
  return text.includes(kw);
}

// 给新闻文本（标题+摘要）判定命中的板块（可多选，按板块顺序返回）
export function classifyCategories(text) {
  if (!text) return [];
  const t = text.toLowerCase();
  const hits = [];
  for (const s of SECTORS) {
    for (const kw of s.keywords) {
      if (matchKw(t, kw.toLowerCase())) { hits.push(s.key); break; }
    }
  }
  return hits;
}
