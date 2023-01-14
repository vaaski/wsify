import type TypedEmitter from "typed-emitter"
import type { WebSocket } from "ws"

import EventEmitter from "node:events"
import http from "node:http"
import net from "node:net"

import { WebSocketServer } from "ws"
import debug from "debug"

const log = debug("wsify")

export interface ConnectionNode {
  host: string
  port: number
}

export type WSProxyEvents = {
  connect: (socket: WebSocket, request: http.IncomingMessage) => void
  disconnect: (socket: WebSocket, code: number, reason: Buffer) => void
  proxyError: (error?: unknown) => void
  listening: () => void
  close: () => void
}

export class WSProxy extends (EventEmitter as new () => TypedEmitter<WSProxyEvents>) {
  public readonly webServer: http.Server
  public readonly wsServer: WebSocketServer

  constructor(
    public readonly from: ConnectionNode,
    public readonly to: ConnectionNode,
    public autoclose = false
  ) {
    super()

    this.webServer = http.createServer()
    this.wsServer = new WebSocketServer({ server: this.webServer })

    this.webServer.listen(from.port, () => {
      this.wsServer.on("connection", this.onNewWSConnection)
      this.emit("listening")

      log(`${from.host}:${from.port} -> ${to.host}:${to.port}`)
    })
  }

  private readonly onNewWSConnection = (socket: WebSocket, request: http.IncomingMessage) => {
    const socketAddress = request.socket.remoteAddress
    log(`new connection from ${socketAddress}`)

    const target = net.createConnection(this.to.port, this.to.host, () => {
      this.emit("connect", socket, request)
    })

    target.on("data", data => {
      socket.send(data)
    })

    target.on("end", () => {
      log("target end")

      socket.close()
    })

    target.on("error", () => {
      log("target error")

      this.emit("proxyError")

      socket.close()
      target.end()
    })

    socket.on("message", data => {
      if (Buffer.isBuffer(data)) target.write(data)
    })

    socket.on("close", (code, reason) => {
      log("socket close")

      target.end()

      this.emit("disconnect", socket, code, reason)
      if (this.autoclose) this.close()
    })

    socket.on("error", error => {
      log("socket error", error)

      this.emit("proxyError", error)

      target.end()
    })
  }

  public close = () => {
    this.wsServer.close()
    this.webServer.close()
    this.emit("close")
  }
}

// const test = () => {
//   const proxy = new WSProxy(
//     { host: "localhost", port: 8080 },
//     { host: "192.168.0.88", port: 5900 },
//     true
//   )

//   proxy.on("connect", () => console.log("connect"))
//   proxy.on("disconnect", () => {
//     proxy.close()
//   })
// }

// test()
