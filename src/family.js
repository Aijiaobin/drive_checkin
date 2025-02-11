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

// 新增工具函数：带超时的 Promise
function timeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`请求超时（${ms}ms）`)), ms)
    )
  ]);
}

// 核心签到逻辑
async function stressTest(account, familyId) {
  let personalTotal = 0, familyTotal = 0;
  const report = [];

  try {
    logger.debug(`🚦 开始压力测试 (账号: ${mask(account.userName)})`);

    const client = new CloudClient(account.userName, account.password);
    await client.login().catch(() => { throw new Error('登录失败') });

    // 个人签到10连击（新增30秒超时）
    const personalPromises = Array(10).fill().map(() =>
      timeout(client.userSign(), 30000)  // 30秒超时控制
        .then(res => {
          const mb = res.netdiskBonus;
          logger.debug(`[${Date.now()}] 🎯 个人签到 ✅ 获得: ${mb}MB`);
          return mb;
        })
        .catch(err => {
          const message = err.message.includes("超时") ? `请求超时（30秒）` : err.message;
          report.push(`[${Date.now()}] 🎯 个人签到 ❌ 获得: 0MB (原因: ${message})`);
          return 0;
        })
    );
    const personalResults = await Promise.allSettled(personalPromises);
    personalTotal = personalResults.reduce((sum, r) => sum + r.value, 0);
    report.push(`🎯 个人签到完成 累计获得: ${personalTotal}MB`);

    // 家庭签到8连击（新增30秒超时）
    const familyPromises = Array(8).fill().map(() =>
      timeout(client.familyUserSign(familyId), 30000)  // 30秒超时控制
        .then(res => {
          const mb = res.bonusSpace;
          logger.debug(`[${Date.now()}] 🏠 家庭签到 ✅ 获得: ${mb}MB`);
          return mb;
        })
        .catch(err => {
          const message = err.message.includes("超时") ? `请求超时（30秒）` : err.message;
          report.push(`[${Date.now()}] 🏠 家庭签到 ❌ 获得: 0MB (原因: ${message})`);
          return 0;
        })
    );
    const familyResults = await Promise.allSettled(familyPromises);
    familyTotal = familyResults.reduce((sum, r) => sum + r.value, 0);
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
        continue;
      }
      const accountConfig = { userName, password };
      const result = await stressTest(accountConfig, familyId);
      reports.push(result.report);
      if (result.success) totalFamily += result.familyTotal;
      if (accounts.length > 1 && index < accounts.length - 1) await sleep(5000);
    }

    const finalReport = `${reports.join('\n\n')}\n\n🏠 所有家庭签到累计获得: ${totalFamily}MB\n执行耗时: ${benchmark.lap()}`;
    sendNotify('天翼云压力测试报告', finalReport);
    logger.debug("📊 测试结果:\n" + finalReport);
  } catch (e) {
    logger.error('致命错误:', e.message);
    process.exit(1);
  }
})();