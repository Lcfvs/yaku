var _ = require("./_");
var genIterator = require("./genIterator");

/**
 * Create a composable observable object.
 * Promise can't resolve multiple times, this function makes it possible, so
 * that you can easily map, filter and even back pressure events in a promise way.
 * For real world example: [Double Click Demo](https://jsfiddle.net/ysmood/musds0sv/).
 * @version_added v0.7.2
 * @param {Function} executor `(emit) ->` It's optional.
 * @return {Observable}
 * @example
 * ```js
 * var Observable = require("yaku/lib/Observable");
 * var linear = new Observable();
 *
 * var x = 0;
 * setInterval(linear.emit, 1000, x++);
 *
 * // Wait for a moment then emit the value.
 * var quad = linear.subscribe(async x => {
 *     await sleep(2000);
 *     return x * x;
 * });
 *
 * var another = linear.subscribe(x => -x);
 *
 * quad.subscribe(
 *     value => { console.log(value); },
 *     reason => { console.error(reason); }
 * );
 *
 * // Emit error
 * linear.emit(Promise.reject(new Error("reason")));
 *
 * // Unsubscribe a observable.
 * quad.unsubscribe();
 *
 * // Unsubscribe all subscribers.
 * linear.subscribers = [];
 * ```
 * @example
 * Use it with DOM.
 * ```js
 * var filter = fn => v => fn(v) ? v : new Promise(() => {});
 *
 * var keyup = new Observable((emit) => {
 *     document.querySelector('input').onkeyup = emit;
 * });
 *
 * var keyupText = keyup.subscribe(e => e.target.value);
 *
 * // Now we only get the input when the text length is greater than 3.
 * var keyupTextGT3 = keyupText.subscribe(filter(text => text.length > 3));
 *
 * keyupTextGT3.subscribe(v => console.log(v));
 * ```
 * @example
 * Merge two sources into one.
 * ```js
 * let one = new Observable(emit => setInterval(emit, 100, 'one'));
 * let two = new Observable(emit => setInterval(emit, 200, 'two'));
 * let merge = list => new Observable(
 *      (emit) => list.forEach(o => o.subscribe(emit))
 * );
 *
 * let three = merge([one, two]);
 * three.subscribe(v => console.log(v));
 * ```
 */
var Observable = module.exports = function Observable (executor) {
    var self = this
    , emit = genEmit(self);

    self.subscribers = [];

    executor && executor(emit);
};

_.extendPrototype(Observable, {

    /**
     * Emit a value.
     * @param  {Any} value
     */
    emit: null,

    /**
     * The publisher observable of this.
     * @type {Observable}
     */
    publisher: null,

    /**
     * All the subscribers subscribed this observable.
     * @type {Array}
     */
    subscribers: null,

    /**
     * It will create a new Observable, like promise.
     * @param  {Function} onEmit
     * @param  {Function} onError
     * @return {Observable}
     */
    subscribe: function (onEmit, onError) {
        var self = this, subscriber = new Observable();
        subscriber._onEmit = onEmit;
        subscriber._onError = onError;
        subscriber._nextErr = genNextErr(subscriber.emit);

        subscriber.publisher = self;
        self.subscribers.push(subscriber);

        return subscriber;
    },

    /**
     * Unsubscribe this.
     */
    unsubscribe: function () {
        var publisher = this.publisher;
        publisher && publisher.subscribers.splice(publisher.subscribers.indexOf(this), 1);
    }

});

function genEmit (self) {
    return self.emit = function (val) {
        var i = 0, len = self.subscribers.length, subscriber;
        while (i < len) {
            subscriber = self.subscribers[i++];
            _.Promise.resolve(val).then(
                subscriber._onEmit,
                subscriber._onError
            ).then(
                subscriber.emit,
                subscriber._nextErr
            );
        }
    };
}

function genNextErr (emit) {
    return function (reason) {
        emit(_.Promise.reject(reason));
    };
}

/**
 * Merge multiple observables into one.
 * @version_added 0.9.6
 * @param  {Iterable} iterable
 * @return {Observable}
 * @example
 * ```js
 * var Observable = require("yaku/lib/Observable");
 * var sleep = require("yaku/lib/sleep");
 *
 * var src = new Observable(function (emit) {
 *     setInterval(emit, 1000, 0);
 * });
 *
 * var a = src.subscribe(function (v) { return v + 1; });
 * var b = src.subscribe(function (v) {
 *     return sleep(10, v + 2);
 * });
 *
 * var out = Observable.all([a, b]);
 *
 * out.subscribe(function (arr) {
 *     console.log(arr);
 * })
 * ```
 */
Observable.all = function all (iterable) {
    var iter = genIterator(iterable);
    return new Observable(function (emit) {
        var result = [], marked = [], count, len = 0, item;

        function onEmit (i) {
            return function (v) {
                result[i] = v;

                if (marked[i]) return;

                marked[i] = true;

                if (!--count) {
                    emit(result);
                    count = len;
                    result = [];
                    marked = [];
                }
            };
        }

        function onError (e) {
            emit(_.Promise.reject(e));
            count = len;
            result = [];
            marked = [];
        }

        while (!(item = iter.next()).done) {
            item.value.subscribe(onEmit(len++), onError);
        }
        count = len;
    });
};


var nodes;
function getNodes (node, isAll) {
    if (!isAll && node.subscribers.length === 0)
        return nodes.push(node);

    node.subscribers.forEach(function (node) {
        if (isAll) nodes.push(node);
        getNodes(node, isAll);
    });
}

/**
 * Subscribe a tree via a root observable.
 * @version_added 0.9.7
 * @param  {Observable} root
 * @param  {Boolean} isAll Whether to subscribe the whole tree or just the leaves.
 * By default only leaves are subscribed.
 * @return {Observable}
 */
Observable.tree = function (root, isAll) {
    nodes = [];
    getNodes(root, isAll);
    return Observable.all(nodes);
};
