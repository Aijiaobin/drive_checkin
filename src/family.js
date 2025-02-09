/* eslint-disable no-await-in-loop */
require("dotenv").config();
const log4js = require("log4js");
const { CloudClient } = require("cloud189-sdk");
const { sendNotify } = require("./sendNotify");

// 日志配置
log4js.configure({
  appenders: {
    debug: {
      type: "console",
      layout: { type: "pattern", pattern: "%[%d{hh:mm:ss} %p %f{1}:%l%] %m" }
    }
  },
  categories: { default: { appenders: ["debug"], level: "debug" } }
});
const logger = log4js.getLogger();

// 调试工具
const benchmark = {
  start: Date.now(),
  lap() {
    return ((Date.now() - this.start) / 1000).toFixed(2) + 's';
  }
};

// 核心签到逻辑
async function stressTest(account, familyId) {
  let personalTotal = 0, familyTotal = 0;
  const report = [];

  try {
    logger.debug(`🚦 开始压力测试 (账号: ${mask(account.userName)})`);

    const client = new CloudClient(account.userName, account.password);
    await client.login().catch(() => { throw new Error('登录失败') });

    // 个人签到5连击
    const personalResults = await Promise.allSettled(
      Array(5).fill().map(() =>
        client.userSign()
          .then(res => res.netdiskBonus)
          .catch(() => 0)
      )
    );
    personalTotal = personalResults.reduce((sum, r) => sum + (r.value || 0), 0);
    report.push(`🎯 个人签到完成 累计获得: ${personalTotal}MB`);

    // 家庭签到8连击
    const familyResults = await Promise.allSettled(
      Array(8).fill().map(() =>
        client.familyUserSign(familyId)
          .then(res => res.bonusSpace)
          .catch(() => 0)
      )
    );
    familyTotal = familyResults.reduce((sum, r) => sum + (r.value || 0), 0);
    report.push(`🏠 家庭签到完成 本次获得: ${familyTotal}MB`);

    return {
      success: true,
      personalTotal,
      familyTotal,
      report: `账号 ${mask(account.userName)}\n${report.join('\n')}`
    };
  } catch (e) {
    return {
      success: false,
      report: `❌ ${mask(account.userName)} 签到失败: ${e.message}`
    };
  }
}

// 辅助方法
function mask(s) {
  return s.replace(/(\d{3})\d+(\d{4})/, '$1****$2');
}
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 执行测试
(async () => {
  try {
    logger.debug("🔥 启动专项压力测试");
    const accounts = require("./accounts");
    const familyId = process.env.FAMILYID;
    if (!familyId) {
      throw new Error('未配置环境变量 FAMILYID');
    }
    let totalFamily = 0;
    const reports = [];

    for (let index = 0; index < accounts.length; index += 1) {
      const account = accounts[index];
      const { userName, password } = account;
      if (!userName || !password) {
        logger.error(`账号配置错误: accounts[${index}]`);
        continue; // Skip to the next account if configuration is invalid
      }
      const accountConfig = { userName, password };
      const result = await stressTest(accountConfig, familyId);
      reports.push(result.report);
      if (result.success) totalFamily += result.familyTotal;
      if (accounts.length > 1 && index < accounts.length - 1) await sleep(5000); // 多账号间隔5秒, 最后一个账号不等待
    }

    const finalReport = `${reports.join('\n\n')}\n\n🏠 所有家庭签到累计获得: ${totalFamily}MB\n执行耗时: ${benchmark.lap()}`;
    sendNotify('天翼云压力测试报告', finalReport);
    logger.debug("📊 测试结果:\n" + finalReport);
  } catch (e) {
    logger.error('致命错误:', e.message);
    process.exit(1);
  }
})();