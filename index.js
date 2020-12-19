const axios = require("axios")
const querystring = require("querystring")

let cheerio = require("cheerio")
let schedule = require("node-schedule")

//定义请求参数
const obj = {
    data: {
        lineId: 4348, //路线id
        vehTime: 0725, //发车时间，
        startTime: 0725, //预计上车时间
        onStationId: 3512, //预定的站点id
        offStationId: 510656,//到站id
        onStationName: '万科城',  //预定的站点名称
        offStationName: "软件产业基地",//预定到站名称
        tradePrice: 0,//总金额
        saleDates: '20',//车票日期
        beginDate: '',//订票时间，滞空，用于抓取到余票后填入数据
    },
    phoneNumber: 123511111,
    cookie: 'JSESSIONID=AF7FCD8DFCD7FFC2347B31D91F13BC70',
    day: "20" //定17号的票，这个主要是用于抢指定日期的票，滞空则为抢当月所有余票

}

class QueryTicket {
    /**
     * 
     */
    constructor({data, phoneNumber, cookie, day }){
        this.data = data
        this.phoneNumber = phoneNumber
        this.cookie = cookie
        this.day = day
        this.postData = querystring.stringify(data)
        this.times = 0; //记录次数
        
        let stop = false //通过特定接口才能修改stop值，防止外部随意串改
        this.getStop = function(){
            return stop
        } 

        this.setStop = function (ifStop) { //设置是否停止
            stop = ifStop
          }
    }

    //原型方法
    //异步初始化
    async init(){
        //返回查询余票数组
        let ticketList = await this.handleQueryTicket() 
        //如果有余票
        if(ticketList.length){
            let resParse = await this.handleBuyTicket(ticketList)
            //执行通知逻辑
            this.handleInfoUser(resParse)
            console.log('ticketList')
        }else{
            console.log('wu') 
        }
    }
    //查询余票逻辑
    async handleQueryTicket(){
        console.log('handleQueryTicket')
        let ticketList = []
        let res = await  this.requestTicket()
        //记录请求查询次数
        this.times ++ 
        //格式化返回值
        let str = res.data.replace(/\\/g, "")
        //cheerio载入查询接口response的html节点数据
        let $ = cheerio.load(`<div class="main">${str}</div>`)
        //查找是否有余票的dom节点
        let list = $(".main").find(".b") 
        // 如果没有余票，打印出请求多少次,然后返回，不执行下面的代码
        if(!list.length){
            console.log(`用户${this.phoneNumber}:无,已进行${this.times}次`)
            return
        }

        //如果有余票
        list.each((idx, item) => {
            //str这时格式是<span>21</span><span>&$x4F59;0</span>
            let str = $(item).html()
            //最后一个span 的内容其实"余0"，也就是无票，只不过是被转码了而已
            //因此要在下一步对其进行格式化
            let arr = str.split(/<span>|<\/span>|\&\$x4F59\;/).filter(irem => !!item === true)
            let data = {
                day: arr[0],
                ticketLeft: arr[1]
            }

            //如果抢指定日期
            if(this.day){
                //如果指定日期有余票
                if(parseInt(data.day) === parseInt(data.day)){
                    ticketList.push(data)
                }
            }else{
                //如果不是，则返回查询到的所有余票
                ticketList.push(data)
            }
        })
        return ticketList
        
    } 


    //调用查询余票接口
    requestTicket(){
        return axios.post('http://weixin.szebus.net/ebus/front/wxQueryController.do?BcTicketCalendar', this.postData, {
            headers: {
                'Content-type' : 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 8_0 like Mac OS X) AppleWebKit/600.1.4 (KHTML, like Gecko) Mobile/12A365 MicroMessenger/5.4.1 NetType/WIFI',
                'Cookie': this.cookie
            }
        })
    } 


    //购票相关逻辑
    async handleBuyTicket(ticketList){
        let year = new Date().getFullYear()
        let month = new Date().getMonth + 1
        let {
            onStationName,//起始站点名
            offStationName,//结束站点名
            lineId,//线路id
            vehTime,//发车时间
            startTime,//预计上车时间
            onStationId,//上车的站台id
            offStationId //到站的站台id
            } = this.data // 初始化的数据

        //站点，发短信时候用到:"宝安交通局-深港产学研基地"
        let station = `${onStationName}-${offStationName}`
        let dateStr = '' //车票日期
        let tickAmount = '' //总张数
        ticketList.forEach(item => {
            dateStr = dateStr + `${year}-${month}-${item.day},`
            tickAmount = tickAmount + `${item.ticketLeft}张,`
        })
        let buyTicket = {
            lineId,//线路id
            vehTime,//发车时间
            startTime,//预计上车时间
            onStationId,//上车的站点id
            offStationId,//目标站点id
            tradePrice: '5', //金额
            saleDates: dateStr.slice(0, -1),
            payType: '2' //支付方式，微信支付
        }     
        let data = querystring.stringify(buyTicket)
        //返回json数据，是否购票成功等等
        let res =  await this.requestOrder(data)
        //传入短信信息所需参数
        return Object.assign({}, JSON.parse(res.data), { queryParam: { dateStr, tickAmount, startTime, station } })
    } 


    //调用购票接口
    requestOrder(obj){
        return axios.post('http://weixin.szebus.net/ebus/front/wxQueryController.do?BcTicketCalendar', obj, {
            headers: {
                'Content-type' : 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 8_0 like Mac OS X) AppleWebKit/600.1.4 (KHTML, like Gecko) Mobile/12A365 MicroMessenger/5.4.1 NetType/WIFI',
                'Cookie': this.cookie
            }
        })
    } 
    //通知用户逻辑
    async handleInfoUser(parseData){
        //获取上一步购票的response数据和我们拼接的数据
        let { returnCode, returnData: {
            main: {
                lineName,
                tradePrice
            },
            queryParam: {
                dateStr,
                tickAmount,
                startTime,
                station
            }
        }} = parseData
        //如果购票成功，则返回500
        if(retrunCode === "500"){
            let res = await this.sendMsg({
                dateStr, //日期
                tickAmount: tickAmount.slice(0, -1), //总张数
                station, //站点
                lineName, //巴士名称/路线名称
                tradePrice,//总价
                startTime,//出发时间
                phoneNumber: this.phoneNumber,//手机号
              })
            //如果发信成功，则不再进行抢票操作
            if(res.errmsg === "success"){
                this.setStop(true)
            }else{
                console.log(res.errmsg)
            }
        }else {
            //失败不做任何操作
            console.log(resParse['returnInfo'])
          }  
    } 
    //信息通知
    sendMsg(){
        // let { dateStr, tickAmount, station, lineName, phoneNumber, startTime, tradePrice } = obj
        return axios.get('https://sc.ftqq.com/SCU112710T267f274e8354070ed1f22378a1b1ec5f5f57030f65974.send?text=主人服务器又挂掉啦~')
    } 
}



// 定时任务
class SetInter {
    constructor({ timer, fn }) {
      this.timer = timer // 每几秒执行
      this.fn = fn //执行的回调
      this.rule = new schedule.RecurrenceRule(); //实例化一个对象
      this.rule.second = this.setRule() // 调用原型方法，schedule的语法而已
      this.init()
    }
    setRule() {
      let rule = [];
      let i = 1;
      while (i < 60) {
        rule.push(i)
        i += this.timer
      }
      return rule //假设传入的timer为5，则表示定时任务每5秒执行一次
      // [1, 6, 11, 16, 21, 26, 31, 36, 41, 46, 51, 56] 
    }
    init() {
      schedule.scheduleJob(this.rule, () => {
        this.fn() // 定时调用传入的回调方法
      });
    }
  }
  

  let ticket = new QueryTicket(obj) //用户1

  new SetInter({
    timer: 8, //每秒执行一次，建议5秒，不然怕被ip拉黑，我这里只是为了方便下面截图
    fn: function () {
    //   [ticket,ticket2].map(item => { //同时进行两个用户的抢票
        if (!ticket.getStop()) {  //调用实例的原型方法，判断是否停止抢票，如果没有则继续抢
            ticket.init()
            console.log('start')
        } else { // 如果抢到票了，则不继续抢票
          console.log('stop')
        }
    //   })
    }
  })
