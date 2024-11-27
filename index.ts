import fetch from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent'; // 导入 HttpsProxyAgent

// 代理设置
const PROXY: string | null = 'http://127.0.0.1:40880'; // 设置您的代理地址，不需要代理则设置为 null
const createAgent = (): HttpsProxyAgent<string> | undefined => { //  修改返回类型
    if (PROXY) {
        return new HttpsProxyAgent(PROXY); // 直接使用 HttpsProxyAgent
    }
    return undefined;
};
const agent = createAgent();
interface BinanceBookTicker {
    askPrice: string;
    // ... other properties
}
interface GateBookTicker {
    bids: [string, string][];
    // ... other properties
}
async function fetchWithProxy<T>(url: string, useProxy: boolean = true): Promise<T | null> {
    const options: any = useProxy && agent ? { agent } : {};
    try {
        const response = await fetch(url, options);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`Error fetching ${url}:`, error);
        return null;
    }
}
async function fetchBinanceBookTicker(symbol: string): Promise<BinanceBookTicker | null> {
    const url = `https://api1.binance.com/api/v3/ticker/bookTicker?symbol=${symbol}`;
    return fetchWithProxy<BinanceBookTicker>(url);
}
async function fetchGateBookTicker(symbol: string): Promise<GateBookTicker | null> {
    const url = `https://api.gateio.ws/api/v4/spot/order_book?currency_pair=${symbol}`;
    return fetchWithProxy<GateBookTicker>(url, false);
}
function calculateAverageSellPrice(buy1Price: number, buy1Quantity: number, buy2Price: number, buy2Quantity: number, totalQuantity: number): number {
    if (buy1Quantity >= totalQuantity) {
        return buy1Price;
    }
    const totalAvailableQuantity = buy1Quantity + buy2Quantity;
    if (totalAvailableQuantity < totalQuantity) {
        console.warn("买一和买二总数量不足以满足卖出需求，使用买二价格");
        return buy2Price;
    }
    const remainingQuantity = totalQuantity - buy1Quantity;
    return (buy1Price * buy1Quantity + buy2Price * remainingQuantity) / totalQuantity;
}
async function sendDingtalkNotification(token: string, title: string, message: string): Promise<void> {
    const url = `https://oapi.dingtalk.com/robot/send?access_token=${token}`;
    const options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            msgtype: "markdown",
            markdown: { title, text: message },
        }),
    };

    try {
        const response = await fetch(url, options);
        if (response.ok) {
            console.log("Notification sent successfully");
        } else {
            console.error(`Failed to send notification. HTTP Status code: ${response.status}`);
        }
    } catch (e) {
        console.error(`Exception occurred while sending notification: ${e}`);
    }
}
async function main(): Promise<void> {
    const monitorSymbol = "USUAL"; // 更改为您要监控的交易对
    const amt = 3000;
    const diffThreshold = 0.12;
    const interval = 5 * 1000; // 毫秒
    const dingToken = "YOUR_DINGTALK_TOKEN"; // 替换为您的钉钉机器人 token

    while (true) {
        const bnBookTickerData = await fetchBinanceBookTicker(`${monitorSymbol}USDT`);
        const gateBookTickerData = await fetchGateBookTicker(`${monitorSymbol}_USDT`);

        if (bnBookTickerData && gateBookTickerData) {
            const bnAskOnePrice = parseFloat(bnBookTickerData.askPrice);
            const gtBidOnePrice = parseFloat(gateBookTickerData.bids[0][0]);
            const gtBidTwoPrice = parseFloat(gateBookTickerData.bids[1][0]);
            const gtBidOneAmt = parseFloat(gateBookTickerData.bids[0][1]);
            const gtBidTwoAmt = parseFloat(gateBookTickerData.bids[1][1]);

            const gtBidAvgPrice = calculateAverageSellPrice(gtBidOnePrice, gtBidOneAmt, gtBidTwoPrice, gtBidTwoAmt, amt);
            const diffPrice = gtBidAvgPrice - bnAskOnePrice;
            const diffRatio = diffPrice / bnAskOnePrice;

            console.log(new Date(), "gt:", gtBidAvgPrice, "bn:", bnAskOnePrice, "dp:", diffPrice, "dg:", diffRatio);

            if (diffRatio >= diffThreshold) {
                await sendDingtalkNotification(
                    dingToken,
                    `Gate/Binance ${monitorSymbol} 价差 ${diffPrice} = ${gtBidAvgPrice} - ${bnAskOnePrice} 超过阈值`,
                    `Gate/Binance ${monitorSymbol} 价差超过阈值\n- 价差: ${diffPrice}\n- 币安卖一: ${bnAskOnePrice}\n- Gate 买一/数量: ${gtBidOnePrice}, ${gtBidOneAmt}\n- Gate 买二/数量: ${gtBidTwoPrice}, ${gtBidTwoAmt}`
                );
            }
        }
        await new Promise(resolve => setTimeout(resolve, interval));
    }
}
main();
