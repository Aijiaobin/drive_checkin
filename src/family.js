/* eslint-disable no-await-in-loop */
require("dotenv").config();
const { pushPlusNotify } = require('./sendNotify.js');
const log4js = require("log4js");
const recording = require("log4js/lib/appenders/recording");
log4js.configure({
    appenders: {
        vcr: { type: "recording" },
        out: { type: "console" }
    },
    categories: { default: { appenders: ["vcr", "out"], level: "info" } },
});

const logger = log4js.getLogger();
const superagent = require("superagent");
const { CloudClient } = require("cloud189-sdk");
const accounts = require("./accounts");
const { sendNotify } = require("./sendNotify");

const mask = (s, start, end) => s.split("").fill("*", start, end).join("");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const threadx = 10; // 签到线程数（不建议修改）

const doTask = async (cloudClient, familyID) => {
    const result = [];
    const signPromises1 = [];
    let getSpace = "签到个人云获得";

    // 处理个人签到
    for (let i = 0; i < threadx; i++) {
        signPromises1.push((async () => {
            const res1 = await cloudClient.userSign();
            if (!res1.isSign) return res1.netdiskBonus;
            return 0;
        })());
    }

    // 处理个人签到结果
    const personalResults = await Promise.all(signPromises1);
    const totalPersonal = personalResults.reduce((a, b) => a + b, 0);
    result.push(`${getSpace} ${totalPersonal}M`);

    // 处理家庭签到
    const { familyInfoResp } = await cloudClient.getFamilyList();
    if (familyInfoResp) {
        const family = familyInfoResp.find(f => f.familyId == familyID) || familyInfoResp[0];
        result.push(`签到家庭云 ID: ${family.familyId}`);

        const signPromises2 = [];
        let familySpace = "获得";
        for (let i = 0; i < threadx; i++) {
            signPromises2.push((async () => {
                const res = await cloudClient.familyUserSign(family.familyId);
                if (!res.signStatus) return res.bonusSpace;
                return 0;
            })());
        }

        // 处理家庭签到结果
        const familyResults = await Promise.all(signPromises2);
        const totalFamily = familyResults.reduce((a, b) => a + b, 0);
        result.push(`${familySpace} ${totalFamily}M`);
    }
    return result;
};

async function main() {
    let results = [];
    let totalFamilyBonus = 0;
    const familyID = process.env.FAMILYID;

    for (let index = 0; index < accounts.length; index++) {
        const account = accounts[index];
        const { userName, password } = account;
        if (!userName || !password) continue;

        const maskedName = mask(userName, 3, 7);
        logger.info(`**** 账号 ${maskedName} 开始执行 ****`);

        try {
            const cloudClient = new CloudClient(userName, password);
            await cloudClient.login();
            const taskResult = await doTask(cloudClient, familyID);

            // 提取家庭奖励数值
            const familyBonus = taskResult.length > 2
                ? parseInt(taskResult[2].match(/\d+/)[0], 10)
                : 0;
            totalFamilyBonus += familyBonus;

            results.push(`账号${index + 1} (${maskedName}): ${taskResult.join("，")}`);
        } catch (e) {
            logger.error(`执行失败: ${e}`);
            results.push(`账号${index + 1} 执行失败`);
        }

        logger.info(`**** 账号 ${maskedName} 执行完毕 ****`);
        await delay(5000);
    }

    // 构建最终结果
    results.push("---", `汇总所有账号家庭奖励: ${totalFamilyBonus}M`);
    return results.join("\n");
}

(async () => {
    try {
        const result = await main();
        await sendNotify("天翼云盘签到结果", result);
    } finally {
        recording.erase();
    }
})();