/* eslint-disable no-await-in-loop */
require("dotenv").config();
const log4js = require("log4js");
const { CloudClient } = require("cloud189-sdk");
const { sendNotify } = require("./sendNotify");

// 增强版日志配置
log4js.configure({
  appenders: {
    debug: {
      type: "console",
      layout: { type: "pattern", pattern: "%[%d{hh:mm:ss} %p %f{1}:%l%] %m" }
    }
  },
  categories: {
    default: {
      appenders: ["debug"],
      level: process.env.DEBUG_MODE ? "debug" : "info"
    }
  }
});
const logger = log4js.getLogger();

// 全局错误拦截
process.on('unhandledRejection', (reason) => {
  logger.error('全局捕获未处理的Promise拒绝:', reason.message);
});

// 压力测试配置
const CONFIG = {
  PERSONAL_CONCURRENCY: 10,    // 个人签到并发数
  FAMILY_CONCURRENCY: 8,       // 家庭签到并发数
  OPERATION_TIMEOUT: 45000,    // 单次操作超时(ms)
  ACCOUNT_INTERVAL: 3000,      // 多账号间隔(ms)
  RETRY_ATTEMPTS: 2            // 全局重试次数
};

// 核心增强工具函数 -------------------------------------------------
function createSafePromise(promise, timeout, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() =>
        reject(new Error(`${label} 操作超时 (${timeout}ms)`)),
        timeout
      )
    )
  ]).catch(e => {
    logger.warn(`安全防护触发 (${label}): ${e.message}`);
    throw e;
  });
}

async function parallelExecutor(tasks, concurrency, label) {
  const results = [];
  let currentIndex = 0;

  while (currentIndex < tasks.length) {
    const batch = tasks
      .slice(currentIndex, currentIndex + concurrency)
      .map(task =>
        task()
          .then(res => ({ status: 'fulfilled', value: res }))
          .catch(e => ({ status: 'rejected', reason: e }))
      );

    try {
      const batchResults = await Promise.all(batch);
      results.push(...batchResults);
    } catch (e) {
      logger.error(`批次执行错误 (${label}): ${e.message}`);
      batch.forEach(() => results.push({ status: 'rejected', reason: e }));
    }

    currentIndex += concurrency;

    // 添加批次间隔防止洪水攻击
    if (currentIndex < tasks.length) {
      await sleep(500 + Math.random() * 1000);
    }
  }

  return results;
}

// 强化版签到逻辑 -------------------------------------------------
async function stressTest(account, familyId) {
  const report = [];
  let personalTotal = 0, familyTotal = 0;

  try {
    logger.debug(`🚦 开始压力测试 (账号: ${mask(account.userName)})`);

    // 登录防护
    const client = await createSafePromise(
      new CloudClient(account.userName, account.password).login(),
      CONFIG.OPERATION_TIMEOUT,
      '账号登录'
    );

    // 个人签到（高并发+自动重试）
    const personalTasks = Array(CONFIG.PERSONAL_CONCURRENCY).fill().map((_, i) =>
      async () => {
        for (let attempt = 1; attempt <= CONFIG.RETRY_ATTEMPTS; attempt++) {
          try {
            const res = await createSafePromise(
              client.userSign(),
              CONFIG.OPERATION_TIMEOUT,
              `个人签到#${i+1}`
            );
            logger.debug(`[${Date.now()}] 🎯 个人签到 ✅ 获得: ${res.netdiskBonus}MB`);
            return res.netdiskBonus;
          } catch (e) {
            if (attempt === CONFIG.RETRY_ATTEMPTS) throw e;
            await sleep(2000 * attempt);
          }
        }
      }
    );

    const personalResults = await parallelExecutor(personalTasks, CONFIG.PERSONAL_CONCURRENCY, '个人签到');
    personalTotal = personalResults.reduce((sum, r) =>
      sum + (r.status === 'fulfilled' ? r.value : 0), 0);
    report.push(`🎯 个人签到完成 累计获得: ${personalTotal}MB`);

    // 家庭签到（高并发+超时控制）
    const familyTasks = Array(CONFIG.FAMILY_CONCURRENCY).fill().map((_, i) =>
      async () => {
        const res = await createSafePromise(
          client.familyUserSign(familyId),
          CONFIG.OPERATION_TIMEOUT,
          `家庭签到#${i+1}`
        );
        logger.debug(`[${Date.now()}] 🏠 家庭签到 ✅ 获得: ${res.bonusSpace}MB`);
        return res.bonusSpace;
      }
    );

    const familyResults = await parallelExecutor(familyTasks, CONFIG.FAMILITY_CONCURRENCY, '家庭签到');
    familyTotal = familyResults.reduce((sum, r) =>
      sum + (r.status === 'fulfilled' ? r.value : 0), 0);
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

// 辅助方法 ------------------------------------------------------
function mask(s) {
  return s.replace(/(\d{3})\d+(\d{4})/, '$1****$2');
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 执行入口 ------------------------------------------------------
(async () => {
  try {
    logger.debug("🔥 启动高并发压力测试");
    const accounts = require("./accounts");
    const familyId = process.env.FAMILYID || '';
    let totalFamily = 0;
    const reports = [];

    // 并行执行所有账号
    await Promise.all(accounts.map(async (account, index) => {
      if (!account.userName || !account.password) {
        logger.error(`账号配置错误: accounts[${index}]`);
        return;
      }

      // 账号间间隔控制
      if (index > 0) await sleep(CONFIG.ACCOUNT_INTERVAL);

      try {
        const result = await stressTest(account, familyId);
        reports.push(result.report);
        if (result.success) totalFamily += result.familyTotal;
      } catch (e) {
        reports.push(`❌ 账号处理异常: ${e.message}`);
      }
    }));

    const finalReport = `${reports.join('\n\n')}\n\n🏠 所有家庭签到累计获得: ${totalFamily}MB`;
    sendNotify('天翼云压力测试报告', finalReport);
    logger.debug("📊 测试结果:\n" + finalReport);
  } catch (e) {
    logger.error('系统级错误:', e.message);
    process.exit(1);
  }
})();