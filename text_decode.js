// 文本编码探测与解码
// 中文 TXT / EPUB 常见 UTF-8、GBK、Big5 混用，直接按 UTF-8 读会整篇乱码

// 高频汉字（简繁兼顾），用于给候选编码打分
const COMMON_HANZI =
  '的一是不了在人有我他这這個們中來来上大为和国地到以说时要就出会可也你对生能而子那得于着下自之年过发后作里用道行所然家种事成方多经么去法学如都同现当没动面起看定天分还进好小部其些主样理心她本前开但因只从想实日军者意无力它与长把机十民第公此已工使情明性知全三又关点正业外将两高间由问很最重并物手应战向头文体政美相见被利什二等产或新己制身果加西斯月话合回特代内信表化老给世位次度门任常先海通教儿原东声提立及比员解水名真论处走义各入几口认条平系气题活尔更别打女变四神总何电数安少报才结反受目太量再感建务做接必场件计管期市直德资命山金指克许统区保至队形社便空决治展马科司五基眼书非则听白却界达光放强即像难且权思王象完设式色路记南品住告类求据程北边死张该交规万取拉格望觉术领共确传师观清今切院让识候带导争运笑飞风步改收根干造言联持组每济车亲极林服快办议往元英士证近失转夫令准布始怎呢存未远叫台单影具罗字爱击流备兵连调深商算质团集百需价花党华城石级整府离况亚请技际约示复病息究线似官火断精满支视消越器容照须九增研写称企八功吗包片史委乎查轻易早曾除农找装广显吧阿李标谈吃图念六引历首医局突专费号尽另周较注语仅考落青随选列武红响虽推势参希古众构房半节土投某案黑维革划敌致陈律足态护七兴派孩验责营星够章音跟志底站严巴例防族供效续施留讲型料终答紧黄绝奇察母京段依批群项故按河米围江织害斗双境客纪采举杀攻父苏密低朝友诉止细愿千值仍男钱破网热助倒育属坐帝限船脸职速刻乐否刚威毛状率甚独球般普怕弹校苦创假久错承印晚兰试股拿脑预谁益阳若哪微尼继送急血惊伤素药适波夜省初喜卫源食险待述陆习置居劳财环排福纳欢雷警获模充负云停木游龙树疑层冷洲冲射略范竟句室异激汉村哈策演简卡罪判担州静退既衣您宗积余痛检差富灵协角占配征修皮挥胜降阶审沉坚善妈刘读超免压银买皇养伊怀执副乱抗犯追帮宣佛岁航优怪香著田铁控税左右份穿艺背阵草脚概恶块顿敢守酒岛托央户烈洋哥索胡款靠评版宝座释景顾弟登货互付伯慢欧换闻危忙核暗姐介坏讨丽良序升监临亮露永呼味野架域沙掉括舰鱼杂误湾吉减编楚肯测败屋跑梦散温困剑渐封救贵枪缺楼县尚毫移娘朋画班智亦耳恩短掌恐遗固席松秘谢鲁遇康虑幸均销钟诗藏赶剧票损忽巨炮旧端探湖录叶春乡附吸予礼港雨呀板庭妇归睛饭额含顺输摇招婚脱补谓督毒油疗旅泽材灭逐莫笔亡鲜词圣择寻厂睡博勒烟授诺伦岸奥唐卖俄炸载洛健堂旁宫喝借君禁阴园谋宋避抓荣姑孙逃牙束跳顶玉镇雪午练迫爷篇肉嘴馆遍凡础洞卷坦牛宁纸诸训私庄祖丝翻暴森塔默握戏隐熟骨访弱蒙歌店鬼软典欲伙遭盘爸扩盖弄雄稳忘亿刺拥徒杨齐赛趣曲刀床迎冰虚玩析窗醒妻透购替塞努休虎扬途侵刑绿兄迅套贸毕唯谷轮库迹尤竞街促延震弃甲伟麻川申缓潜闪售灯针哲络抵朱抱鼓植纯夏忍页杰筑折郑贝尊吴秀混臣雅振染盛怒舞圆搞狂措姓残秋培迷诚宽宇猛摆梅毁伸摩盟末乃悲拍丁赵硬麦蒋操邪镜晴';

const COMMON_SET = new Set(COMMON_HANZI);

// 给一段解码结果打分：越像正常中文越高
function scoreText(text) {
  const sample = text.length > 30000 ? text.slice(0, 30000) : text;
  let score = 0;
  for (const ch of sample) {
    const c = ch.codePointAt(0);
    if (c === 0xFFFD) { score -= 6; continue; }              // 替换符
    if (c === 0x09 || c === 0x0A || c === 0x0D) { score += 1; continue; }
    if (c < 0x20) { score -= 4; continue; }                  // 控制符
    if (c < 0x7F) { score += 1; continue; }                  // ASCII
    if (COMMON_SET.has(ch)) { score += 3; continue; }        // 高频汉字
    if (c >= 0x4E00 && c <= 0x9FFF) { score += 1; continue; } // 其它汉字
    if (c >= 0x3000 && c <= 0x303F) { score += 2; continue; } // 中文标点
    if (c >= 0xFF00 && c <= 0xFFEF) { score += 1; continue; } // 全角
    if (c >= 0x2000 && c <= 0x206F) { score += 1; continue; } // 通用标点
    if (c >= 0xE000 && c <= 0xF8FF) { score -= 5; continue; } // 私用区
    if (c >= 0x0080 && c <= 0x00FF) { score -= 2; continue; } // 拉丁扩展，多为误解码
    score += 1;
  }
  return score;
}

function tryDecode(buffer, encoding) {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(buffer);
  } catch (e) {
    return null;
  }
}

// 自动识别编码并解码为字符串
function decodeText(buffer) {
  if (!buffer || buffer.length === 0) return '';
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

  // 1. BOM 优先
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    return new TextDecoder('utf-8').decode(buf.subarray(3));
  }
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
    return new TextDecoder('utf-16le').decode(buf.subarray(2));
  }
  if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {
    return new TextDecoder('utf-16be').decode(buf.subarray(2));
  }

  // 2. 严格 UTF-8 能通过就直接用
  const utf8 = tryDecode(buf, 'utf-8');
  if (utf8 !== null) return utf8;

  // 3. 候选编码打分取最优
  const candidates = ['gb18030', 'big5', 'shift_jis', 'euc-kr'];
  let best = null;
  let bestScore = -Infinity;
  for (const enc of candidates) {
    const text = tryDecode(buf, enc);
    if (text === null) continue;
    const score = scoreText(text);
    if (score > bestScore) {
      bestScore = score;
      best = text;
    }
  }
  if (best !== null) return best;

  // 4. 兜底：宽松 UTF-8
  return new TextDecoder('utf-8').decode(buf);
}

module.exports = { decodeText };
