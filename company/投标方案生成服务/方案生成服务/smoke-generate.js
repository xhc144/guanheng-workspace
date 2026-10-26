// Run only in an isolated verification directory, never as a live paid order.
const path=require('node:path');
const {OrderStore}=require('./orders'),{Generator}=require('./generator');
const dir=process.argv[2];if(!dir||!dir.includes('verification'))throw new Error('Use isolated verification directory');
const store=new OrderStore(path.join(dir,'orders'));
const order=store.create('offline-test@example.invalid',{company:'海澜精密制造（测试）有限公司',industry:'精密电子制造',products:'精密电子结构件，多工序加工',locations:'中国总部及越南工厂',erp:'SAP',mode:'EPE，具体口径待确认',needs:'进出口单证重复录入，采购、生产与关务库存难以核对。需要建立物料映射、进口收料关联、出口追溯、月度平衡与年度清算流程。',timeline:'期望十二周，具体待评估'},'verification_request_0001');
const generator=new Generator(store,path.join(dir,'files'));
generator.generate(order).then(files=>console.log(JSON.stringify({ok:true,files}))).catch(e=>{console.error(e.message);process.exitCode=1;});
