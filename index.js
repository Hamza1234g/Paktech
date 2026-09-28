require("dotenv").config();
const express=require("express"), cors=require("cors"), bcrypt=require("bcryptjs"), jwt=require("jsonwebtoken");
const Database=require("better-sqlite3");
const Stripe=require("stripe");
const path=require("path");

const app=express(), PORT=process.env.PORT||3000;
const db=new Database(path.join(__dirname,"pakcart.db"));
db.pragma("journal_mode = WAL");
app.use(cors()); app.use(express.json({limit:"2mb"}));
app.use(express.static(path.join(__dirname,"public")));

db.exec(`
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,
 name TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'customer',status TEXT DEFAULT 'active',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS categories(
 id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE NOT NULL,slug TEXT UNIQUE NOT NULL,active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS products(
 id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,category_id INTEGER,brand TEXT,price REAL NOT NULL,
 compare_price REAL,stock INTEGER DEFAULT 0,rating REAL DEFAULT 0,seller_id INTEGER,sku TEXT UNIQUE,
 image TEXT,active INTEGER DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(category_id) REFERENCES categories(id), FOREIGN KEY(seller_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS orders(
 id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,total REAL NOT NULL,status TEXT DEFAULT 'pending',
 payment_method TEXT DEFAULT 'cod',payment_status TEXT DEFAULT 'unpaid',shipping_address TEXT,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id));
CREATE TABLE IF NOT EXISTS order_items(
 id INTEGER PRIMARY KEY AUTOINCREMENT,order_id INTEGER,product_id INTEGER,qty INTEGER,price REAL,
 FOREIGN KEY(order_id) REFERENCES orders(id),FOREIGN KEY(product_id) REFERENCES products(id));
CREATE TABLE IF NOT EXISTS sections(
 id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,kind TEXT DEFAULT 'products',position INTEGER DEFAULT 0,active INTEGER DEFAULT 1,config TEXT DEFAULT '{}');
CREATE TABLE IF NOT EXISTS audit_logs(
 id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,action TEXT,entity TEXT,entity_id INTEGER,details TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS payments(
 id INTEGER PRIMARY KEY AUTOINCREMENT,order_id INTEGER,provider TEXT,provider_id TEXT,status TEXT,amount REAL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);

function seed(){
 const adminEmail=process.env.ADMIN_EMAIL||"admin@pakcart.local";
 if(!db.prepare("SELECT id FROM users WHERE email=?").get(adminEmail)){
   const hash=bcrypt.hashSync(process.env.ADMIN_PASSWORD||"ChangeMe123!",12);
   db.prepare("INSERT INTO users(email,password,name,role) VALUES(?,?,?,?)").run(adminEmail,hash,"PakCart Admin","admin");
 }
 const cats=["Laptops","Gaming","Audio","Networking","Smart Devices","Mobile Accessories","Computer Accessories","Computer Components"];
 const ins=db.prepare("INSERT OR IGNORE INTO categories(name,slug) VALUES(?,?)");
 cats.forEach(c=>ins.run(c,c.toLowerCase().replaceAll(" ","-")));
 if(db.prepare("SELECT COUNT(*) c FROM products").get().c===0){
   const seller=db.prepare("INSERT OR IGNORE INTO users(email,password,name,role) VALUES(?,?,?,?)").run("seller@pakcart.local",bcrypt.hashSync("Seller123!",12),"Demo Seller","seller");
   const sid=db.prepare("SELECT id FROM users WHERE email='seller@pakcart.local'").get().id;
   const ps=[
    ["ProBook 15 Laptop Core i5","Laptops",124999,139999,18,"💻"],
    ["Wireless ANC Headphones","Audio",7499,9999,44,"🎧"],
    ["Mechanical RGB Gaming Keyboard","Gaming",6299,7999,26,"⌨️"],
    ["Smart Watch Series X","Smart Devices",8999,11999,31,"⌚"],
    ["WiFi 6 Dual Band Router","Networking",6499,8499,23,"📡"],
    ["65W GaN Fast Charger","Mobile Accessories",3299,4299,70,"🔌"]
   ];
   const q=db.prepare("INSERT INTO products(name,category_id,brand,price,compare_price,stock,seller_id,sku,image) VALUES(?,?,?,?,?,?,?,?,?)");
   ps.forEach((p,i)=>{let c=db.prepare("SELECT id FROM categories WHERE name=?").get(p[1]);q.run(p[0],c.id,"PakCart",p[2],p[3],p[4],sid,"SKU-"+(1000+i),p[5])});
 }
 if(db.prepare("SELECT COUNT(*) c FROM sections").get().c===0){
  const q=db.prepare("INSERT INTO sections(title,kind,position,config) VALUES(?,?,?,?)");
  q.run("Flash Sale","products",1,JSON.stringify({limit:6}));
  q.run("Recommended for You","products",2,JSON.stringify({limit:6}));
  q.run("Shop by Category","categories",3,JSON.stringify({limit:8}));
 }
}
seed();

function auth(req,res,next){
 const h=req.headers.authorization||""; if(!h.startsWith("Bearer ")) return res.status(401).json({error:"Authentication required"});
 try{req.user=jwt.verify(h.slice(7),process.env.JWT_SECRET||"dev_secret_change_me");next()}catch(e){res.status(401).json({error:"Invalid token"})}
}
function role(...roles){return (req,res,next)=>roles.includes(req.user.role)?next():res.status(403).json({error:"Forbidden"})}
function log(req,action,entity,id,details=""){db.prepare("INSERT INTO audit_logs(user_id,action,entity,entity_id,details) VALUES(?,?,?,?,?)").run(req.user?.id||null,action,entity,id,details)}

app.get("/api/health",(req,res)=>res.json({ok:true,time:new Date().toISOString()}));
app.post("/api/auth/login",(req,res)=>{
 const u=db.prepare("SELECT * FROM users WHERE email=?").get(req.body.email);
 if(!u||!bcrypt.compareSync(req.body.password,u.password))return res.status(401).json({error:"Invalid email or password"});
 const token=jwt.sign({id:u.id,email:u.email,name:u.name,role:u.role},process.env.JWT_SECRET||"dev_secret_change_me",{expiresIn:"7d"});
 res.json({token,user:{id:u.id,email:u.email,name:u.name,role:u.role}});
});
app.get("/api/me",auth,(req,res)=>res.json(req.user));

app.get("/api/categories",(req,res)=>res.json(db.prepare("SELECT * FROM categories WHERE active=1 ORDER BY name").all()));
app.post("/api/categories",auth,role("admin"),(req,res)=>{
 const r=db.prepare("INSERT INTO categories(name,slug) VALUES(?,?)").run(req.body.name,req.body.slug||req.body.name.toLowerCase().replaceAll(" ","-"));log(req,"create","category",r.lastInsertRowid);res.json({id:r.lastInsertRowid});
});
app.delete("/api/categories/:id",auth,role("admin"),(req,res)=>{db.prepare("UPDATE categories SET active=0 WHERE id=?").run(req.params.id);log(req,"delete","category",req.params.id);res.json({ok:true})});

app.get("/api/products",(req,res)=>{
 let sql=`SELECT p.*,c.name category,u.name seller FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN users u ON u.id=p.seller_id WHERE p.active=1`;
 const args=[]; if(req.query.q){sql+=" AND (p.name LIKE ? OR p.brand LIKE ? OR p.sku LIKE ?)";let q="%"+req.query.q+"%";args.push(q,q,q)}
 if(req.query.category){sql+=" AND c.slug=?";args.push(req.query.category)}
 sql+=" ORDER BY p.created_at DESC"; res.json(db.prepare(sql).all(...args));
});
app.post("/api/products",auth,role("admin","seller"),(req,res)=>{
 const b=req.body; if(!b.name||!b.price)return res.status(400).json({error:"name and price required"});
 const seller=req.user.role==="seller"?req.user.id:(b.seller_id||null);
 const r=db.prepare(`INSERT INTO products(name,category_id,brand,price,compare_price,stock,seller_id,sku,image) VALUES(?,?,?,?,?,?,?,?,?)`)
 .run(b.name,b.category_id||null,b.brand||"",b.price,b.compare_price||null,b.stock||0,seller,b.sku||("SKU-"+Date.now()),b.image||"");
 log(req,"create","product",r.lastInsertRowid);res.json({id:r.lastInsertRowid});
});
app.put("/api/products/:id",auth,role("admin","seller"),(req,res)=>{
 const p=db.prepare("SELECT * FROM products WHERE id=?").get(req.params.id);
 if(!p||req.user.role==="seller"&&p.seller_id!==req.user.id)return res.status(404).json({error:"Not found"});
 const b=req.body;db.prepare(`UPDATE products SET name=?,category_id=?,brand=?,price=?,compare_price=?,stock=?,sku=?,image=? WHERE id=?`)
 .run(b.name,p.category_id,b.brand,b.price,b.compare_price,b.stock,b.sku,b.image,p.id);log(req,"update","product",p.id);res.json({ok:true});
});
app.delete("/api/products/:id",auth,role("admin","seller"),(req,res)=>{
 const p=db.prepare("SELECT * FROM products WHERE id=?").get(req.params.id);
 if(!p||req.user.role==="seller"&&p.seller_id!==req.user.id)return res.status(404).json({error:"Not found"});
 db.prepare("UPDATE products SET active=0 WHERE id=?").run(p.id);log(req,"delete","product",p.id);res.json({ok:true});
});

app.get("/api/sections",(req,res)=>res.json(db.prepare("SELECT * FROM sections ORDER BY position,id").all()));
app.post("/api/sections",auth,role("admin"),(req,res)=>{
 const r=db.prepare("INSERT INTO sections(title,kind,position,config) VALUES(?,?,?,?)").run(req.body.title,req.body.kind||"products",req.body.position||99,JSON.stringify(req.body.config||{}));
 log(req,"create","section",r.lastInsertRowid);res.json({id:r.lastInsertRowid});
});
app.put("/api/sections/:id",auth,role("admin"),(req,res)=>{
 db.prepare("UPDATE sections SET title=?,kind=?,position=?,active=?,config=? WHERE id=?").run(req.body.title,req.body.kind,req.body.position,req.body.active?1:0,JSON.stringify(req.body.config||{}),req.params.id);log(req,"update","section",req.params.id);res.json({ok:true});
});
app.delete("/api/sections/:id",auth,role("admin"),(req,res)=>{db.prepare("DELETE FROM sections WHERE id=?").run(req.params.id);log(req,"delete","section",req.params.id);res.json({ok:true})});

app.post("/api/orders",auth,async(req,res)=>{
 const items=req.body.items||[]; if(!items.length)return res.status(400).json({error:"Cart empty"});
 const get=db.prepare("SELECT * FROM products WHERE id=? AND active=1");
 let total=0,rows=[];
 for(const x of items){const p=get.get(x.product_id);if(!p||p.stock<x.qty)return res.status(400).json({error:`Unavailable product ${x.product_id}`});total+=p.price*x.qty;rows.push({p,qty:x.qty})}
 const tx=db.transaction(()=>{
   const o=db.prepare("INSERT INTO orders(user_id,total,payment_method,shipping_address) VALUES(?,?,?,?)").run(req.user.id,total,req.body.payment_method||"cod",req.body.shipping_address||"");
   const iq=db.prepare("INSERT INTO order_items(order_id,product_id,qty,price) VALUES(?,?,?,?)");
   const uq=db.prepare("UPDATE products SET stock=stock-? WHERE id=?");
   rows.forEach(x=>{iq.run(o.lastInsertRowid,x.p.id,x.qty,x.p.price);uq.run(x.qty,x.p.id)});
   return o.lastInsertRowid;
 }); const id=tx();log(req,"create","order",id);
 res.json({order_id:id,total,payment_method:req.body.payment_method||"cod"});
});

app.get("/api/orders",auth,(req,res)=>{
 let sql=`SELECT o.*,u.name customer,u.email FROM orders o JOIN users u ON u.id=o.user_id`;let args=[];
 if(req.user.role==="customer"){sql+=" WHERE o.user_id=?";args=[req.user.id]}
 else if(req.user.role==="seller"){sql+=" JOIN order_items oi ON oi.order_id=o.id JOIN products p ON p.id=oi.product_id WHERE p.seller_id=?";args=[req.user.id]}
 sql+=" GROUP BY o.id ORDER BY o.created_at DESC";res.json(db.prepare(sql).all(...args));
});
app.put("/api/orders/:id/status",auth,role("admin","seller"),(req,res)=>{db.prepare("UPDATE orders SET status=? WHERE id=?").run(req.body.status,req.params.id);log(req,"status","order",req.params.id,req.body.status);res.json({ok:true})});

app.get("/api/admin/analytics",auth,role("admin"),(req,res)=>{
 const revenue=db.prepare("SELECT COALESCE(SUM(total),0) v FROM orders WHERE payment_status='paid' OR payment_method='cod'").get().v;
 const orders=db.prepare("SELECT COUNT(*) v FROM orders").get().v;
 const users=db.prepare("SELECT COUNT(*) v FROM users").get().v;
 const products=db.prepare("SELECT COUNT(*) v FROM products WHERE active=1").get().v;
 const stock=db.prepare("SELECT COALESCE(SUM(stock),0) v FROM products WHERE active=1").get().v;
 const byStatus=db.prepare("SELECT status,COUNT(*) count FROM orders GROUP BY status").all();
 const top=db.prepare("SELECT p.name,SUM(oi.qty) units,SUM(oi.qty*oi.price) sales FROM order_items oi JOIN products p ON p.id=oi.product_id GROUP BY p.id ORDER BY sales DESC LIMIT 10").all();
 res.json({revenue,orders,users,products,stock,byStatus,top});
});
app.get("/api/admin/users",auth,role("admin"),(req,res)=>res.json(db.prepare("SELECT id,name,email,role,status,created_at FROM users ORDER BY created_at DESC").all()));
app.get("/api/admin/audit",auth,role("admin"),(req,res)=>res.json(db.prepare("SELECT a.*,u.name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 100").all()));

app.post("/api/payments/create-checkout",auth,async(req,res)=>{
 if(!process.env.STRIPE_SECRET_KEY)return res.status(503).json({error:"Stripe is not configured. Set STRIPE_SECRET_KEY in .env"});
 const stripe=Stripe(process.env.STRIPE_SECRET_KEY);const o=db.prepare("SELECT * FROM orders WHERE id=? AND user_id=?").get(req.body.order_id,req.user.id);
 if(!o)return res.status(404).json({error:"Order not found"});
 const session=await stripe.checkout.sessions.create({mode:"payment",line_items:[{price_data:{currency:"pkr",product_data:{name:`PakCart Order #${o.id}`},unit_amount:Math.round(o.total*100)},quantity:1}],success_url:`${req.protocol}://${req.get("host")}/?payment=success&order=${o.id}`,cancel_url:`${req.protocol}://${req.get("host")}/?payment=cancelled`,metadata:{order_id:String(o.id)}});
 db.prepare("INSERT INTO payments(order_id,provider,provider_id,status,amount) VALUES(?,?,?,?,?)").run(o.id,"stripe",session.id,"pending",o.total);
 res.json({url:session.url});
});

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"index.html")));
app.listen(PORT,()=>console.log(`PakCart running on http://localhost:${PORT}`));
