# 服务端
进入server目录，安装依赖

```
cd server
npm install
```

安装完成后运行服务

```
node server.js
```

# 客户端
进入front目录，安装依赖

```
cd front
npm install
```
启动服务

```
live-server
```
如果报错说没有live-server的话，全局安装live-server再试
```
npm install -g live-server
```


# ***重要提示***

启动后的地址一般是这种形式：

127.0.0.1:8080

但是协同编辑是有用户概念的，所以请在后面加上id来模拟不同的用户，如：

127.0.0.1:8080/?id=Lily

127.0.0.1:8080/?id=Alen