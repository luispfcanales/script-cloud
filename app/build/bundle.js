
(function(l, r) { if (!l || l.getElementById('livereloadscript')) return; r = l.createElement('script'); r.async = 1; r.src = '//' + (self.location.host || 'localhost').split(':')[0] + ':35729/livereload.js?snipver=1'; r.id = 'livereloadscript'; l.getElementsByTagName('head')[0].appendChild(r) })(self.document);
var app = (function () {
    'use strict';

    function noop() { }
    function add_location(element, file, line, column, char) {
        element.__svelte_meta = {
            loc: { file, line, column, char }
        };
    }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
    }
    function null_to_empty(value) {
        return value == null ? '' : value;
    }

    // Track which nodes are claimed during hydration. Unclaimed nodes can then be removed from the DOM
    // at the end of hydration without touching the remaining nodes.
    let is_hydrating = false;
    function start_hydrating() {
        is_hydrating = true;
    }
    function end_hydrating() {
        is_hydrating = false;
    }
    function upper_bound(low, high, key, value) {
        // Return first index of value larger than input value in the range [low, high)
        while (low < high) {
            const mid = low + ((high - low) >> 1);
            if (key(mid) <= value) {
                low = mid + 1;
            }
            else {
                high = mid;
            }
        }
        return low;
    }
    function init_hydrate(target) {
        if (target.hydrate_init)
            return;
        target.hydrate_init = true;
        // We know that all children have claim_order values since the unclaimed have been detached
        const children = target.childNodes;
        /*
        * Reorder claimed children optimally.
        * We can reorder claimed children optimally by finding the longest subsequence of
        * nodes that are already claimed in order and only moving the rest. The longest
        * subsequence subsequence of nodes that are claimed in order can be found by
        * computing the longest increasing subsequence of .claim_order values.
        *
        * This algorithm is optimal in generating the least amount of reorder operations
        * possible.
        *
        * Proof:
        * We know that, given a set of reordering operations, the nodes that do not move
        * always form an increasing subsequence, since they do not move among each other
        * meaning that they must be already ordered among each other. Thus, the maximal
        * set of nodes that do not move form a longest increasing subsequence.
        */
        // Compute longest increasing subsequence
        // m: subsequence length j => index k of smallest value that ends an increasing subsequence of length j
        const m = new Int32Array(children.length + 1);
        // Predecessor indices + 1
        const p = new Int32Array(children.length);
        m[0] = -1;
        let longest = 0;
        for (let i = 0; i < children.length; i++) {
            const current = children[i].claim_order;
            // Find the largest subsequence length such that it ends in a value less than our current value
            // upper_bound returns first greater value, so we subtract one
            const seqLen = upper_bound(1, longest + 1, idx => children[m[idx]].claim_order, current) - 1;
            p[i] = m[seqLen] + 1;
            const newLen = seqLen + 1;
            // We can guarantee that current is the smallest value. Otherwise, we would have generated a longer sequence.
            m[newLen] = i;
            longest = Math.max(newLen, longest);
        }
        // The longest increasing subsequence of nodes (initially reversed)
        const lis = [];
        // The rest of the nodes, nodes that will be moved
        const toMove = [];
        let last = children.length - 1;
        for (let cur = m[longest] + 1; cur != 0; cur = p[cur - 1]) {
            lis.push(children[cur - 1]);
            for (; last >= cur; last--) {
                toMove.push(children[last]);
            }
            last--;
        }
        for (; last >= 0; last--) {
            toMove.push(children[last]);
        }
        lis.reverse();
        // We sort the nodes being moved to guarantee that their insertion order matches the claim order
        toMove.sort((a, b) => a.claim_order - b.claim_order);
        // Finally, we move the nodes
        for (let i = 0, j = 0; i < toMove.length; i++) {
            while (j < lis.length && toMove[i].claim_order >= lis[j].claim_order) {
                j++;
            }
            const anchor = j < lis.length ? lis[j] : null;
            target.insertBefore(toMove[i], anchor);
        }
    }
    function append(target, node) {
        if (is_hydrating) {
            init_hydrate(target);
            if ((target.actual_end_child === undefined) || ((target.actual_end_child !== null) && (target.actual_end_child.parentElement !== target))) {
                target.actual_end_child = target.firstChild;
            }
            if (node !== target.actual_end_child) {
                target.insertBefore(node, target.actual_end_child);
            }
            else {
                target.actual_end_child = node.nextSibling;
            }
        }
        else if (node.parentNode !== target) {
            target.appendChild(node);
        }
    }
    function insert(target, node, anchor) {
        if (is_hydrating && !anchor) {
            append(target, node);
        }
        else if (node.parentNode !== target || (anchor && node.nextSibling !== anchor)) {
            target.insertBefore(node, anchor || null);
        }
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function empty() {
        return text('');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function custom_event(type, detail) {
        const e = document.createEvent('CustomEvent');
        e.initCustomEvent(type, false, false, detail);
        return e;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    let flushing = false;
    const seen_callbacks = new Set();
    function flush() {
        if (flushing)
            return;
        flushing = true;
        do {
            // first, call beforeUpdate functions
            // and update components
            for (let i = 0; i < dirty_components.length; i += 1) {
                const component = dirty_components[i];
                set_current_component(component);
                update(component.$$);
            }
            set_current_component(null);
            dirty_components.length = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        flushing = false;
        seen_callbacks.clear();
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    let outros;
    function group_outros() {
        outros = {
            r: 0,
            c: [],
            p: outros // parent group
        };
    }
    function check_outros() {
        if (!outros.r) {
            run_all(outros.c);
        }
        outros = outros.p;
    }
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
    }
    function outro_and_destroy_block(block, lookup) {
        transition_out(block, 1, 1, () => {
            lookup.delete(block.key);
        });
    }
    function update_keyed_each(old_blocks, dirty, get_key, dynamic, ctx, list, lookup, node, destroy, create_each_block, next, get_context) {
        let o = old_blocks.length;
        let n = list.length;
        let i = o;
        const old_indexes = {};
        while (i--)
            old_indexes[old_blocks[i].key] = i;
        const new_blocks = [];
        const new_lookup = new Map();
        const deltas = new Map();
        i = n;
        while (i--) {
            const child_ctx = get_context(ctx, list, i);
            const key = get_key(child_ctx);
            let block = lookup.get(key);
            if (!block) {
                block = create_each_block(key, child_ctx);
                block.c();
            }
            else if (dynamic) {
                block.p(child_ctx, dirty);
            }
            new_lookup.set(key, new_blocks[i] = block);
            if (key in old_indexes)
                deltas.set(key, Math.abs(i - old_indexes[key]));
        }
        const will_move = new Set();
        const did_move = new Set();
        function insert(block) {
            transition_in(block, 1);
            block.m(node, next);
            lookup.set(block.key, block);
            next = block.first;
            n--;
        }
        while (o && n) {
            const new_block = new_blocks[n - 1];
            const old_block = old_blocks[o - 1];
            const new_key = new_block.key;
            const old_key = old_block.key;
            if (new_block === old_block) {
                // do nothing
                next = new_block.first;
                o--;
                n--;
            }
            else if (!new_lookup.has(old_key)) {
                // remove old block
                destroy(old_block, lookup);
                o--;
            }
            else if (!lookup.has(new_key) || will_move.has(new_key)) {
                insert(new_block);
            }
            else if (did_move.has(old_key)) {
                o--;
            }
            else if (deltas.get(new_key) > deltas.get(old_key)) {
                did_move.add(new_key);
                insert(new_block);
            }
            else {
                will_move.add(old_key);
                o--;
            }
        }
        while (o--) {
            const old_block = old_blocks[o];
            if (!new_lookup.has(old_block.key))
                destroy(old_block, lookup);
        }
        while (n)
            insert(new_blocks[n - 1]);
        return new_blocks;
    }
    function validate_each_keys(ctx, list, get_context, get_key) {
        const keys = new Set();
        for (let i = 0; i < list.length; i++) {
            const key = get_key(get_context(ctx, list, i));
            if (keys.has(key)) {
                throw new Error('Cannot have duplicate keys in a keyed each');
            }
            keys.add(key);
        }
    }
    function create_component(block) {
        block && block.c();
    }
    function mount_component(component, target, anchor, customElement) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        if (!customElement) {
            // onMount happens before the initial afterUpdate
            add_render_callback(() => {
                const new_on_destroy = on_mount.map(run).filter(is_function);
                if (on_destroy) {
                    on_destroy.push(...new_on_destroy);
                }
                else {
                    // Edge case - component was destroyed immediately,
                    // most likely as a result of a binding initialising
                    run_all(new_on_destroy);
                }
                component.$$.on_mount = [];
            });
        }
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            on_disconnect: [],
            before_update: [],
            after_update: [],
            context: new Map(parent_component ? parent_component.$$.context : options.context || []),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false
        };
        let ready = false;
        $$.ctx = instance
            ? instance(component, options.props || {}, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                start_hydrating();
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor, options.customElement);
            end_hydrating();
            flush();
        }
        set_current_component(parent_component);
    }
    /**
     * Base class for Svelte components. Used when dev=false.
     */
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set($$props) {
            if (this.$$set && !is_empty($$props)) {
                this.$$.skip_bound = true;
                this.$$set($$props);
                this.$$.skip_bound = false;
            }
        }
    }

    function dispatch_dev(type, detail) {
        document.dispatchEvent(custom_event(type, Object.assign({ version: '3.38.3' }, detail)));
    }
    function append_dev(target, node) {
        dispatch_dev('SvelteDOMInsert', { target, node });
        append(target, node);
    }
    function insert_dev(target, node, anchor) {
        dispatch_dev('SvelteDOMInsert', { target, node, anchor });
        insert(target, node, anchor);
    }
    function detach_dev(node) {
        dispatch_dev('SvelteDOMRemove', { node });
        detach(node);
    }
    function listen_dev(node, event, handler, options, has_prevent_default, has_stop_propagation) {
        const modifiers = options === true ? ['capture'] : options ? Array.from(Object.keys(options)) : [];
        if (has_prevent_default)
            modifiers.push('preventDefault');
        if (has_stop_propagation)
            modifiers.push('stopPropagation');
        dispatch_dev('SvelteDOMAddEventListener', { node, event, handler, modifiers });
        const dispose = listen(node, event, handler, options);
        return () => {
            dispatch_dev('SvelteDOMRemoveEventListener', { node, event, handler, modifiers });
            dispose();
        };
    }
    function attr_dev(node, attribute, value) {
        attr(node, attribute, value);
        if (value == null)
            dispatch_dev('SvelteDOMRemoveAttribute', { node, attribute });
        else
            dispatch_dev('SvelteDOMSetAttribute', { node, attribute, value });
    }
    function prop_dev(node, property, value) {
        node[property] = value;
        dispatch_dev('SvelteDOMSetProperty', { node, property, value });
    }
    function set_data_dev(text, data) {
        data = '' + data;
        if (text.wholeText === data)
            return;
        dispatch_dev('SvelteDOMSetData', { node: text, data });
        text.data = data;
    }
    function validate_each_argument(arg) {
        if (typeof arg !== 'string' && !(arg && typeof arg === 'object' && 'length' in arg)) {
            let msg = '{#each} only iterates over array-like objects.';
            if (typeof Symbol === 'function' && arg && Symbol.iterator in arg) {
                msg += ' You can use a spread to convert this iterable into an array.';
            }
            throw new Error(msg);
        }
    }
    function validate_slots(name, slot, keys) {
        for (const slot_key of Object.keys(slot)) {
            if (!~keys.indexOf(slot_key)) {
                console.warn(`<${name}> received an unexpected slot "${slot_key}".`);
            }
        }
    }
    /**
     * Base class for Svelte components with some minor dev-enhancements. Used when dev=true.
     */
    class SvelteComponentDev extends SvelteComponent {
        constructor(options) {
            if (!options || (!options.target && !options.$$inline)) {
                throw new Error("'target' is a required option");
            }
            super();
        }
        $destroy() {
            super.$destroy();
            this.$destroy = () => {
                console.warn('Component was already destroyed'); // eslint-disable-line no-console
            };
        }
        $capture_state() { }
        $inject_state() { }
    }

    /* src/components/OnlineStatusButton.svelte generated by Svelte v3.38.3 */

    const file$6 = "src/components/OnlineStatusButton.svelte";

    function create_fragment$6(ctx) {
    	let div;
    	let div_class_value;

    	const block = {
    		c: function create() {
    			div = element("div");
    			attr_dev(div, "class", div_class_value = "" + (null_to_empty(`rounded ${/*StatusButton*/ ctx[0] ? "active" : ""}`) + " svelte-6n3w6o"));
    			add_location(div, file$6, 4, 0, 51);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    		},
    		p: function update(ctx, [dirty]) {
    			if (dirty & /*StatusButton*/ 1 && div_class_value !== (div_class_value = "" + (null_to_empty(`rounded ${/*StatusButton*/ ctx[0] ? "active" : ""}`) + " svelte-6n3w6o"))) {
    				attr_dev(div, "class", div_class_value);
    			}
    		},
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$6.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$6($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots("OnlineStatusButton", slots, []);
    	let { StatusButton = false } = $$props;
    	const writable_props = ["StatusButton"];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== "$$") console.warn(`<OnlineStatusButton> was created with unknown prop '${key}'`);
    	});

    	$$self.$$set = $$props => {
    		if ("StatusButton" in $$props) $$invalidate(0, StatusButton = $$props.StatusButton);
    	};

    	$$self.$capture_state = () => ({ StatusButton });

    	$$self.$inject_state = $$props => {
    		if ("StatusButton" in $$props) $$invalidate(0, StatusButton = $$props.StatusButton);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	return [StatusButton];
    }

    class OnlineStatusButton extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$6, create_fragment$6, safe_not_equal, { StatusButton: 0 });

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "OnlineStatusButton",
    			options,
    			id: create_fragment$6.name
    		});
    	}

    	get StatusButton() {
    		throw new Error("<OnlineStatusButton>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set StatusButton(value) {
    		throw new Error("<OnlineStatusButton>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}
    }

    /* src/components/CardNote.svelte generated by Svelte v3.38.3 */
    const file$5 = "src/components/CardNote.svelte";

    function create_fragment$5(ctx) {
    	let div2;
    	let h4;
    	let t0;
    	let t1;
    	let div0;
    	let t2;
    	let t3;
    	let div1;
    	let p;
    	let t4;
    	let t5;
    	let onlinestatusbutton;
    	let current;
    	let mounted;
    	let dispose;

    	onlinestatusbutton = new OnlineStatusButton({
    			props: { StatusButton: /*View*/ ctx[4] },
    			$$inline: true
    		});

    	const block = {
    		c: function create() {
    			div2 = element("div");
    			h4 = element("h4");
    			t0 = text(/*Title*/ ctx[1]);
    			t1 = space();
    			div0 = element("div");
    			t2 = text(/*Description*/ ctx[2]);
    			t3 = space();
    			div1 = element("div");
    			p = element("p");
    			t4 = text(/*DateNote*/ ctx[3]);
    			t5 = space();
    			create_component(onlinestatusbutton.$$.fragment);
    			attr_dev(h4, "class", "svelte-e2tgf1");
    			add_location(h4, file$5, 13, 1, 466);
    			attr_dev(div0, "class", "content-description svelte-e2tgf1");
    			add_location(div0, file$5, 14, 1, 484);
    			add_location(p, file$5, 16, 2, 567);
    			attr_dev(div1, "class", "content-date svelte-e2tgf1");
    			add_location(div1, file$5, 15, 1, 538);
    			attr_dev(div2, "id", /*Id*/ ctx[0]);
    			attr_dev(div2, "class", "content-card  svelte-e2tgf1");
    			add_location(div2, file$5, 12, 0, 403);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div2, anchor);
    			append_dev(div2, h4);
    			append_dev(h4, t0);
    			append_dev(div2, t1);
    			append_dev(div2, div0);
    			append_dev(div0, t2);
    			append_dev(div2, t3);
    			append_dev(div2, div1);
    			append_dev(div1, p);
    			append_dev(p, t4);
    			append_dev(div2, t5);
    			mount_component(onlinestatusbutton, div2, null);
    			current = true;

    			if (!mounted) {
    				dispose = listen_dev(
    					div2,
    					"click",
    					function () {
    						if (is_function(/*ActiveCardNote*/ ctx[5])) /*ActiveCardNote*/ ctx[5].apply(this, arguments);
    					},
    					false,
    					false,
    					false
    				);

    				mounted = true;
    			}
    		},
    		p: function update(new_ctx, [dirty]) {
    			ctx = new_ctx;
    			if (!current || dirty & /*Title*/ 2) set_data_dev(t0, /*Title*/ ctx[1]);
    			if (!current || dirty & /*Description*/ 4) set_data_dev(t2, /*Description*/ ctx[2]);
    			if (!current || dirty & /*DateNote*/ 8) set_data_dev(t4, /*DateNote*/ ctx[3]);
    			const onlinestatusbutton_changes = {};
    			if (dirty & /*View*/ 16) onlinestatusbutton_changes.StatusButton = /*View*/ ctx[4];
    			onlinestatusbutton.$set(onlinestatusbutton_changes);

    			if (!current || dirty & /*Id*/ 1) {
    				attr_dev(div2, "id", /*Id*/ ctx[0]);
    			}
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(onlinestatusbutton.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(onlinestatusbutton.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div2);
    			destroy_component(onlinestatusbutton);
    			mounted = false;
    			dispose();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$5.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$5($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots("CardNote", slots, []);
    	let { Id = "identifier" } = $$props;
    	let { Title = "A simple Note" } = $$props;
    	let { Description = "this is little description to appp notes, is incredible very,very izi my name is luis angel" } = $$props;
    	let { DateNote = "Thursday, 8 July 2021" } = $$props;
    	let { View = false } = $$props;
    	let { ActiveCardNote } = $$props;
    	const writable_props = ["Id", "Title", "Description", "DateNote", "View", "ActiveCardNote"];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== "$$") console.warn(`<CardNote> was created with unknown prop '${key}'`);
    	});

    	$$self.$$set = $$props => {
    		if ("Id" in $$props) $$invalidate(0, Id = $$props.Id);
    		if ("Title" in $$props) $$invalidate(1, Title = $$props.Title);
    		if ("Description" in $$props) $$invalidate(2, Description = $$props.Description);
    		if ("DateNote" in $$props) $$invalidate(3, DateNote = $$props.DateNote);
    		if ("View" in $$props) $$invalidate(4, View = $$props.View);
    		if ("ActiveCardNote" in $$props) $$invalidate(5, ActiveCardNote = $$props.ActiveCardNote);
    	};

    	$$self.$capture_state = () => ({
    		OnlineStatusButton,
    		Id,
    		Title,
    		Description,
    		DateNote,
    		View,
    		ActiveCardNote
    	});

    	$$self.$inject_state = $$props => {
    		if ("Id" in $$props) $$invalidate(0, Id = $$props.Id);
    		if ("Title" in $$props) $$invalidate(1, Title = $$props.Title);
    		if ("Description" in $$props) $$invalidate(2, Description = $$props.Description);
    		if ("DateNote" in $$props) $$invalidate(3, DateNote = $$props.DateNote);
    		if ("View" in $$props) $$invalidate(4, View = $$props.View);
    		if ("ActiveCardNote" in $$props) $$invalidate(5, ActiveCardNote = $$props.ActiveCardNote);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	return [Id, Title, Description, DateNote, View, ActiveCardNote];
    }

    class CardNote extends SvelteComponentDev {
    	constructor(options) {
    		super(options);

    		init(this, options, instance$5, create_fragment$5, safe_not_equal, {
    			Id: 0,
    			Title: 1,
    			Description: 2,
    			DateNote: 3,
    			View: 4,
    			ActiveCardNote: 5
    		});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "CardNote",
    			options,
    			id: create_fragment$5.name
    		});

    		const { ctx } = this.$$;
    		const props = options.props || {};

    		if (/*ActiveCardNote*/ ctx[5] === undefined && !("ActiveCardNote" in props)) {
    			console.warn("<CardNote> was created without expected prop 'ActiveCardNote'");
    		}
    	}

    	get Id() {
    		throw new Error("<CardNote>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set Id(value) {
    		throw new Error("<CardNote>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get Title() {
    		throw new Error("<CardNote>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set Title(value) {
    		throw new Error("<CardNote>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get Description() {
    		throw new Error("<CardNote>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set Description(value) {
    		throw new Error("<CardNote>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get DateNote() {
    		throw new Error("<CardNote>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set DateNote(value) {
    		throw new Error("<CardNote>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get View() {
    		throw new Error("<CardNote>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set View(value) {
    		throw new Error("<CardNote>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get ActiveCardNote() {
    		throw new Error("<CardNote>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set ActiveCardNote(value) {
    		throw new Error("<CardNote>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}
    }

    /* src/components/ButtonAddNote.svelte generated by Svelte v3.38.3 */

    const file$4 = "src/components/ButtonAddNote.svelte";

    function create_fragment$4(ctx) {
    	let button;

    	const block = {
    		c: function create() {
    			button = element("button");
    			button.textContent = "Add Note";
    			attr_dev(button, "class", "svelte-18nvz0b");
    			add_location(button, file$4, 3, 0, 20);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, button, anchor);
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(button);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$4.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$4($$self, $$props) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots("ButtonAddNote", slots, []);
    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== "$$") console.warn(`<ButtonAddNote> was created with unknown prop '${key}'`);
    	});

    	return [];
    }

    class ButtonAddNote extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$4, create_fragment$4, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "ButtonAddNote",
    			options,
    			id: create_fragment$4.name
    		});
    	}
    }

    /* src/components/PreviewNote.svelte generated by Svelte v3.38.3 */

    const file$3 = "src/components/PreviewNote.svelte";

    function create_fragment$3(ctx) {
    	let div;
    	let h1;
    	let t0;
    	let t1;
    	let hr;
    	let t2;
    	let textarea;

    	const block = {
    		c: function create() {
    			div = element("div");
    			h1 = element("h1");
    			t0 = text(/*Title*/ ctx[0]);
    			t1 = space();
    			hr = element("hr");
    			t2 = space();
    			textarea = element("textarea");
    			attr_dev(h1, "class", "title-note svelte-rhhjw2");
    			add_location(h1, file$3, 6, 1, 201);
    			attr_dev(hr, "class", "svelte-rhhjw2");
    			add_location(hr, file$3, 7, 1, 238);
    			textarea.value = /*Description*/ ctx[1];
    			attr_dev(textarea, "class", "svelte-rhhjw2");
    			add_location(textarea, file$3, 8, 1, 244);
    			attr_dev(div, "class", "container svelte-rhhjw2");
    			add_location(div, file$3, 5, 0, 176);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div, anchor);
    			append_dev(div, h1);
    			append_dev(h1, t0);
    			append_dev(div, t1);
    			append_dev(div, hr);
    			append_dev(div, t2);
    			append_dev(div, textarea);
    		},
    		p: function update(ctx, [dirty]) {
    			if (dirty & /*Title*/ 1) set_data_dev(t0, /*Title*/ ctx[0]);

    			if (dirty & /*Description*/ 2) {
    				prop_dev(textarea, "value", /*Description*/ ctx[1]);
    			}
    		},
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$3.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$3($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots("PreviewNote", slots, []);
    	let { Title = "A Sample Note" } = $$props;
    	let { Description = "this is little description to appp notes, is incredible very,very izi my name is luis angel" } = $$props;
    	const writable_props = ["Title", "Description"];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== "$$") console.warn(`<PreviewNote> was created with unknown prop '${key}'`);
    	});

    	$$self.$$set = $$props => {
    		if ("Title" in $$props) $$invalidate(0, Title = $$props.Title);
    		if ("Description" in $$props) $$invalidate(1, Description = $$props.Description);
    	};

    	$$self.$capture_state = () => ({ Title, Description });

    	$$self.$inject_state = $$props => {
    		if ("Title" in $$props) $$invalidate(0, Title = $$props.Title);
    		if ("Description" in $$props) $$invalidate(1, Description = $$props.Description);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	return [Title, Description];
    }

    class PreviewNote extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$3, create_fragment$3, safe_not_equal, { Title: 0, Description: 1 });

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "PreviewNote",
    			options,
    			id: create_fragment$3.name
    		});
    	}

    	get Title() {
    		throw new Error("<PreviewNote>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set Title(value) {
    		throw new Error("<PreviewNote>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	get Description() {
    		throw new Error("<PreviewNote>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set Description(value) {
    		throw new Error("<PreviewNote>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}
    }

    /* src/components/WellcomeMessage.svelte generated by Svelte v3.38.3 */

    const file$2 = "src/components/WellcomeMessage.svelte";

    function create_fragment$2(ctx) {
    	let div1;
    	let h1;
    	let t1;
    	let div0;
    	let img;
    	let img_src_value;
    	let t2;
    	let h3;

    	const block = {
    		c: function create() {
    			div1 = element("div");
    			h1 = element("h1");
    			h1.textContent = `${/*message*/ ctx[0]}`;
    			t1 = space();
    			div0 = element("div");
    			img = element("img");
    			t2 = space();
    			h3 = element("h3");
    			h3.textContent = `${/*version*/ ctx[1]}`;
    			attr_dev(h1, "class", "svelte-1m9vzq2");
    			add_location(h1, file$2, 6, 1, 159);
    			if (img.src !== (img_src_value = "./gopherConclusion-min.png")) attr_dev(img, "src", img_src_value);
    			attr_dev(img, "alt", "wellcome");
    			attr_dev(img, "class", "svelte-1m9vzq2");
    			add_location(img, file$2, 8, 2, 209);
    			attr_dev(div0, "class", "content-image svelte-1m9vzq2");
    			add_location(div0, file$2, 7, 1, 179);
    			attr_dev(h3, "class", "svelte-1m9vzq2");
    			add_location(h3, file$2, 10, 1, 273);
    			attr_dev(div1, "class", "container svelte-1m9vzq2");
    			add_location(div1, file$2, 5, 0, 134);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div1, anchor);
    			append_dev(div1, h1);
    			append_dev(div1, t1);
    			append_dev(div1, div0);
    			append_dev(div0, img);
    			append_dev(div1, t2);
    			append_dev(div1, h3);
    		},
    		p: noop,
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div1);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$2.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$2($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots("WellcomeMessage", slots, []);
    	let message = "Wellcome Gopher!";
    	let version = `Bienvenido a "App Notes". Estamos felices de que estés aquí...`;
    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== "$$") console.warn(`<WellcomeMessage> was created with unknown prop '${key}'`);
    	});

    	$$self.$capture_state = () => ({ message, version });

    	$$self.$inject_state = $$props => {
    		if ("message" in $$props) $$invalidate(0, message = $$props.message);
    		if ("version" in $$props) $$invalidate(1, version = $$props.version);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	return [message, version];
    }

    class WellcomeMessage extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$2, create_fragment$2, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "WellcomeMessage",
    			options,
    			id: create_fragment$2.name
    		});
    	}
    }

    let ListNotes = [
    	{
    		Id: "0",
    		Title:"A Sample Note",
    		Description:"this is little description to appp notes, is incredible very,very izi my name is luis angel",
    		DateNote:"Thursday, 8 July 2021",
    		ActiveNote:false
    	},
    	{
    		Id: "1",
    		Title:"Example of a Sample Note",
    		Description:"small description to app notes, complicated and very,very izi really lorem ipsum",
    		DateNote:"Thursday, 8 July 2021",
    		ActiveNote:false
    	}
    ];

    function GetIndexCardActive(list) {
    	for(let i=0;i<list.length;i++){
    		if(list[i].ActiveNote){
    			return i
    		}
    	}
    	return null
    }

    function DeselectCard(list,id) {
    	const indexCurrentActiveCard = GetIndexCardActive(list);
    	if(indexCurrentActiveCard == id) {//id not is integer for reason not compare ===
    		return list
    	}
    	if(typeof indexCurrentActiveCard === 'number' ) { 
    		list[indexCurrentActiveCard].ActiveNote = false;
    	}
    	return list
    }

    function RenderCurrentNote(list,id) {
    	if(list[id].ActiveNote){
    		return true
    	}
    	return false
    }

    /* src/views/Note.svelte generated by Svelte v3.38.3 */
    const file$1 = "src/views/Note.svelte";

    function get_each_context(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[6] = list[i].Id;
    	child_ctx[7] = list[i].ActiveNote;
    	child_ctx[8] = list[i].Title;
    	child_ctx[9] = list[i].Description;
    	return child_ctx;
    }

    // (30:3) {#each Notes as {Id,ActiveNote,Title,Description}
    function create_each_block(key_1, ctx) {
    	let first;
    	let cardnote;
    	let current;

    	function func() {
    		return /*func*/ ctx[5](/*Id*/ ctx[6]);
    	}

    	cardnote = new CardNote({
    			props: {
    				Id: /*Id*/ ctx[6],
    				Title: /*Title*/ ctx[8],
    				Description: /*Description*/ ctx[9],
    				View: /*ActiveNote*/ ctx[7],
    				ActiveCardNote: func
    			},
    			$$inline: true
    		});

    	const block = {
    		key: key_1,
    		first: null,
    		c: function create() {
    			first = empty();
    			create_component(cardnote.$$.fragment);
    			this.first = first;
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, first, anchor);
    			mount_component(cardnote, target, anchor);
    			current = true;
    		},
    		p: function update(new_ctx, dirty) {
    			ctx = new_ctx;
    			const cardnote_changes = {};
    			if (dirty & /*Notes*/ 4) cardnote_changes.Id = /*Id*/ ctx[6];
    			if (dirty & /*Notes*/ 4) cardnote_changes.Title = /*Title*/ ctx[8];
    			if (dirty & /*Notes*/ 4) cardnote_changes.Description = /*Description*/ ctx[9];
    			if (dirty & /*Notes*/ 4) cardnote_changes.View = /*ActiveNote*/ ctx[7];
    			if (dirty & /*Notes*/ 4) cardnote_changes.ActiveCardNote = func;
    			cardnote.$set(cardnote_changes);
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(cardnote.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(cardnote.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(first);
    			destroy_component(cardnote, detaching);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_each_block.name,
    		type: "each",
    		source: "(30:3) {#each Notes as {Id,ActiveNote,Title,Description}",
    		ctx
    	});

    	return block;
    }

    // (47:2) {:else}
    function create_else_block(ctx) {
    	let wellcomemessage;
    	let current;
    	wellcomemessage = new WellcomeMessage({ $$inline: true });

    	const block = {
    		c: function create() {
    			create_component(wellcomemessage.$$.fragment);
    		},
    		m: function mount(target, anchor) {
    			mount_component(wellcomemessage, target, anchor);
    			current = true;
    		},
    		p: noop,
    		i: function intro(local) {
    			if (current) return;
    			transition_in(wellcomemessage.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(wellcomemessage.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			destroy_component(wellcomemessage, detaching);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_else_block.name,
    		type: "else",
    		source: "(47:2) {:else}",
    		ctx
    	});

    	return block;
    }

    // (42:2) {#if ViewNote }
    function create_if_block(ctx) {
    	let previewnote;
    	let current;

    	previewnote = new PreviewNote({
    			props: {
    				Title: /*Notes*/ ctx[2][/*IdRenderNote*/ ctx[1]].Title,
    				Description: /*Notes*/ ctx[2][/*IdRenderNote*/ ctx[1]].Description
    			},
    			$$inline: true
    		});

    	const block = {
    		c: function create() {
    			create_component(previewnote.$$.fragment);
    		},
    		m: function mount(target, anchor) {
    			mount_component(previewnote, target, anchor);
    			current = true;
    		},
    		p: function update(ctx, dirty) {
    			const previewnote_changes = {};
    			if (dirty & /*Notes, IdRenderNote*/ 6) previewnote_changes.Title = /*Notes*/ ctx[2][/*IdRenderNote*/ ctx[1]].Title;
    			if (dirty & /*Notes, IdRenderNote*/ 6) previewnote_changes.Description = /*Notes*/ ctx[2][/*IdRenderNote*/ ctx[1]].Description;
    			previewnote.$set(previewnote_changes);
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(previewnote.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(previewnote.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			destroy_component(previewnote, detaching);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_if_block.name,
    		type: "if",
    		source: "(42:2) {#if ViewNote }",
    		ctx
    	});

    	return block;
    }

    function create_fragment$1(ctx) {
    	let div3;
    	let div1;
    	let buttonaddnote;
    	let t0;
    	let div0;
    	let each_blocks = [];
    	let each_1_lookup = new Map();
    	let t1;
    	let div2;
    	let current_block_type_index;
    	let if_block;
    	let current;
    	buttonaddnote = new ButtonAddNote({ $$inline: true });
    	let each_value = /*Notes*/ ctx[2];
    	validate_each_argument(each_value);
    	const get_key = ctx => /*Id*/ ctx[6];
    	validate_each_keys(ctx, each_value, get_each_context, get_key);

    	for (let i = 0; i < each_value.length; i += 1) {
    		let child_ctx = get_each_context(ctx, each_value, i);
    		let key = get_key(child_ctx);
    		each_1_lookup.set(key, each_blocks[i] = create_each_block(key, child_ctx));
    	}

    	const if_block_creators = [create_if_block, create_else_block];
    	const if_blocks = [];

    	function select_block_type(ctx, dirty) {
    		if (/*ViewNote*/ ctx[0]) return 0;
    		return 1;
    	}

    	current_block_type_index = select_block_type(ctx);
    	if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);

    	const block = {
    		c: function create() {
    			div3 = element("div");
    			div1 = element("div");
    			create_component(buttonaddnote.$$.fragment);
    			t0 = space();
    			div0 = element("div");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			t1 = space();
    			div2 = element("div");
    			if_block.c();
    			attr_dev(div0, "class", "content-note svelte-cbi20p");
    			add_location(div0, file$1, 27, 2, 882);
    			attr_dev(div1, "class", "content-preview-note svelte-cbi20p");
    			add_location(div1, file$1, 25, 1, 824);
    			attr_dev(div2, "class", "content-render-note svelte-cbi20p");
    			add_location(div2, file$1, 40, 1, 1129);
    			attr_dev(div3, "class", "content svelte-cbi20p");
    			add_location(div3, file$1, 24, 0, 801);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div3, anchor);
    			append_dev(div3, div1);
    			mount_component(buttonaddnote, div1, null);
    			append_dev(div1, t0);
    			append_dev(div1, div0);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(div0, null);
    			}

    			append_dev(div3, t1);
    			append_dev(div3, div2);
    			if_blocks[current_block_type_index].m(div2, null);
    			current = true;
    		},
    		p: function update(ctx, [dirty]) {
    			if (dirty & /*Notes, ActiveCardNote*/ 12) {
    				each_value = /*Notes*/ ctx[2];
    				validate_each_argument(each_value);
    				group_outros();
    				validate_each_keys(ctx, each_value, get_each_context, get_key);
    				each_blocks = update_keyed_each(each_blocks, dirty, get_key, 1, ctx, each_value, each_1_lookup, div0, outro_and_destroy_block, create_each_block, null, get_each_context);
    				check_outros();
    			}

    			let previous_block_index = current_block_type_index;
    			current_block_type_index = select_block_type(ctx);

    			if (current_block_type_index === previous_block_index) {
    				if_blocks[current_block_type_index].p(ctx, dirty);
    			} else {
    				group_outros();

    				transition_out(if_blocks[previous_block_index], 1, 1, () => {
    					if_blocks[previous_block_index] = null;
    				});

    				check_outros();
    				if_block = if_blocks[current_block_type_index];

    				if (!if_block) {
    					if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
    					if_block.c();
    				} else {
    					if_block.p(ctx, dirty);
    				}

    				transition_in(if_block, 1);
    				if_block.m(div2, null);
    			}
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(buttonaddnote.$$.fragment, local);

    			for (let i = 0; i < each_value.length; i += 1) {
    				transition_in(each_blocks[i]);
    			}

    			transition_in(if_block);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(buttonaddnote.$$.fragment, local);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				transition_out(each_blocks[i]);
    			}

    			transition_out(if_block);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div3);
    			destroy_component(buttonaddnote);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].d();
    			}

    			if_blocks[current_block_type_index].d();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$1.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$1($$self, $$props, $$invalidate) {
    	let Notes;
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots("Note", slots, []);
    	let ListCurrentNotes = ListNotes;
    	let ViewNote = false;
    	let IdRenderNote = 0;

    	const ActiveCardNote = id => {
    		$$invalidate(4, ListCurrentNotes = DeselectCard(ListCurrentNotes, id));
    		$$invalidate(4, ListCurrentNotes[id].ActiveNote = !ListCurrentNotes[id].ActiveNote, ListCurrentNotes);
    		$$invalidate(0, ViewNote = RenderCurrentNote(ListCurrentNotes, id));
    		$$invalidate(1, IdRenderNote = id);
    	};

    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== "$$") console.warn(`<Note> was created with unknown prop '${key}'`);
    	});

    	const func = Id => {
    		ActiveCardNote(Id);
    	};

    	$$self.$capture_state = () => ({
    		CardNote,
    		ButtonAddNote,
    		PreviewNote,
    		WellcomeMessage,
    		ListNotes,
    		DeselectCard,
    		RenderCurrentNote,
    		ListCurrentNotes,
    		ViewNote,
    		IdRenderNote,
    		ActiveCardNote,
    		Notes
    	});

    	$$self.$inject_state = $$props => {
    		if ("ListCurrentNotes" in $$props) $$invalidate(4, ListCurrentNotes = $$props.ListCurrentNotes);
    		if ("ViewNote" in $$props) $$invalidate(0, ViewNote = $$props.ViewNote);
    		if ("IdRenderNote" in $$props) $$invalidate(1, IdRenderNote = $$props.IdRenderNote);
    		if ("Notes" in $$props) $$invalidate(2, Notes = $$props.Notes);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*ListCurrentNotes*/ 16) {
    			$$invalidate(2, Notes = ListCurrentNotes);
    		}
    	};

    	return [ViewNote, IdRenderNote, Notes, ActiveCardNote, ListCurrentNotes, func];
    }

    class Note extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$1, create_fragment$1, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Note",
    			options,
    			id: create_fragment$1.name
    		});
    	}
    }

    /* src/App.svelte generated by Svelte v3.38.3 */
    const file = "src/App.svelte";

    function create_fragment(ctx) {
    	let main;
    	let note;
    	let current;
    	note = new Note({ $$inline: true });

    	const block = {
    		c: function create() {
    			main = element("main");
    			create_component(note.$$.fragment);
    			add_location(main, file, 4, 0, 60);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, main, anchor);
    			mount_component(note, main, null);
    			current = true;
    		},
    		p: noop,
    		i: function intro(local) {
    			if (current) return;
    			transition_in(note.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(note.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(main);
    			destroy_component(note);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots("App", slots, []);
    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== "$$") console.warn(`<App> was created with unknown prop '${key}'`);
    	});

    	$$self.$capture_state = () => ({ Note });
    	return [];
    }

    class App extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance, create_fragment, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "App",
    			options,
    			id: create_fragment.name
    		});
    	}
    }

    const app = new App({
    	target: document.body,
    });

    return app;

}());
//# sourceMappingURL=bundle.js.map
