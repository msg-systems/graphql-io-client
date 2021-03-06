/*
**  GraphQL-IO -- GraphQL Network Communication Framework
**  Copyright (c) 2016-2018 Ralf S. Engelschall <rse@engelschall.com>
**
**  Permission is hereby granted, free of charge, to any person obtaining
**  a copy of this software and associated documentation files (the
**  "Software"), to deal in the Software without restriction, including
**  without limitation the rights to use, copy, modify, merge, publish,
**  distribute, sublicense, and/or sell copies of the Software, and to
**  permit persons to whom the Software is furnished to do so, subject to
**  the following conditions:
**
**  The above copyright notice and this permission notice shall be included
**  in all copies or substantial portions of the Software.
**
**  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
**  EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
**  MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
**  IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
**  CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
**  TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
**  SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

/*  external dependencies  */
import UUID  from "pure-uuid"
import clone from "clone"

/*  the Subscription class  */
export default class Subscription {
    constructor (query, onResult) {
        /*  define internal state  */
        Object.defineProperty(this, "_", {
            configurable: false,
            enumerable:   false,
            writable:     false,
            value:        {}
        })

        /*  remember internal state  */
        this._.query       = query
        this._.onResult    = onResult
        this._.state       = "subscribed"
        this._.iid         = (new UUID(1)).format()
        this._.sid         = ""
        this._.next        = Promise.resolve()
    }

    /*  check status  */
    state () {
        return this._.state
    }

    /*  force refetching of subscription  */
    refetch () {
        return (this._.next = this._.next.then(() => {
            if (     this._.state !== "subscribed"
                && (!this._.query._.api._.subscriptions[this._.sid]
                ||  !this._.query._.api._.subscriptions[this._.sid][this._.iid]))
                return
            if (this._.state !== "subscribed")
                throw new Error(`query not active (currently in "${this._.state}" state)`)
            let args = this._.query.__assembleArgs()
            let promise = this._.query._.api._.graphqlClient.query(args)
            return promise.then((result) => {
                /*  clone data structure  */
                result = clone(result, false)

                /*  extract subscription id from "_Subscription.subscribe" field  */
                if (   typeof result === "object"
                    && result !== null
                    && typeof result.data === "object"
                    && result.data !== null
                    && typeof result.data._Subscription === "object"
                    && result.data._Subscription !== null
                    && typeof result.data._Subscription.subscribe === "string") {
                    this._.sid = result.data._Subscription.subscribe
                    if (this._.query._.api._.subscriptions[this._.sid] === undefined)
                        this._.query._.api._.subscriptions[this._.sid] = {}
                    this._.query._.api._.subscriptions[this._.sid][this._.iid] = this
                    delete result.data._Subscription
                }
                return result
            }, (error) => {
                if (!(error instanceof Error))
                    error = new Error(error)
                return { data: null, errors: [ error ] }
            }).then((result) => {
                this._.query.__processResults(result, ` <sid: ${this._.sid !== "" ? this._.sid : "none"}>`)
                this._.onResult(result)
                return true
            })
        }))
    }

    /*  pause subscription  */
    pause () {
        return (this._.next = this._.next.then(() => {
            if (this._.state !== "subscribed")
                throw new Error(`query not active (currently in "${this._.state}" state)`)
            return this._.query._.api.graphql(`mutation ($sid: UUID!) {
                _Subscription { pause(sid: $sid) }
            }`, { sid: this._.sid }).then(() => {
                this._.state = "paused"
                return true
            })
        }))
    }

    /*  resume subscription  */
    resume () {
        return (this._.next = this._.next.then(() => {
            if (this._.state !== "paused")
                throw new Error(`query not paused (currently in "${this._.state}" state)`)
            return this._.query._.api.graphql(`mutation ($sid: UUID!) {
                _Subscription { resume(sid: $sid) }
            }`, { sid: this._.sid }).then(() => {
                this._.state = "subscribed"
                return true
            })
        }))
    }

    /*  undo subscription  */
    unsubscribe () {
        return (this._.next = this._.next.then(() => {
            if (this._.state === "unsubscribed")
                throw new Error("query already unsubscribed")
            return this._.query._.api.graphql(`mutation ($sid: UUID!) {
                _Subscription { unsubscribe(sid: $sid) }
            }`, { sid: this._.sid }).then(() => {
                delete this._.query._.api._.subscriptions[this._.sid][this._.iid]
                if (Object.keys(this._.query._.api._.subscriptions[this._.sid]).length === 0)
                    delete this._.query._.api._.subscriptions[this._.sid]
                this._.state = "unsubscribed"
                return true
            })
        }))
    }
}

