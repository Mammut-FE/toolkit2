/*
 * NEJ Utility API
 * @module   script/nej/util
 * @author   genify(caijf@corp.netease.com)
 */
var util = require('util'),
   _fs   = require('../../util/file.js'),
   _path = require('../../util/path.js');
/**
 * complete nej injector uri
 * config properties,all root config should be absolute path
 * - pathRoot       file path for uri relative to
 * - webRoot        web root path
 * - libRoot        nej lib root path
 * - params         other parameters config
 * @param  {String} uri    - nej uri string
 * @param  {Object} config - path parameter config
 * @return {Object} uri information after complete,eg. {uri:'',patch:'',plugin:''}
 */
exports.parseURI = function(uri,config){
    config = config||{};
    // for json!/path/to/data.json
    var arr = (uri||'').split('!'),
        ret = {
            uri:arr[0]||''
        };
    if (arr.length>1){
        ret.plugin = arr.shift().toLowerCase();
        ret.uri = arr.join('!');
    }
    // for {platform}hack.js
    if (ret.uri.indexOf('{platform}')===0){
        ret.uri = ret.uri.replace('{platform}','./platform/');
        ret.patch = ret.uri.replace(/(\.js)$/i,'.patch$1');
    }
    // complete patch uri
    if (!!ret.patch){
        ret.patch = this.parseURI(ret.patch,config).uri;
    }
    // for begin with ./ or ../ or /
    if (/^[./]/.test(ret.uri)){
        ret.uri = _path.absoluteAltRoot(
            ret.uri,config.pathRoot,config.webRoot
        );
        return ret;
    }
    var dict = config.params||{};
    // for begin with {abc}a.js
    if (ret.uri.indexOf('{')===0){
        ret.uri = ret.uri.replace(/\{(.*?)\}/gi,function($1,$2){
            return dict[$2]||$1;
        });
        return ret;
    }
    // for lib/util/base or pro/a/b/c
    var brr = ret.uri.split('/'),
        root = dict[brr[0]],
        ext = /\.js$/i.test(brr[brr.length-1])?'':'.js';
    if (!!root){
        brr.shift();
    }else{
        root = config.libRoot||'';
    }
    ret.uri = root+brr.join('/')+ext;
    return ret;
};
/**
 * parse platform string
 * result properties
 * - engines        platform supported
 * - lower          platform lower version
 * @param  {String} platform - platform config
 * @return {Object} result of platform config
 */
exports.parsePlatform = (function(){
    var _pMap = {
        td:'trident',wk:'webkit',gk:'gecko',
        android:'webkit',ios:'webkit',cef:'webkit',win:'trident'
    };
    return function(platform){
        platform = (platform||'td|wk|gk').toLowerCase();
        var ret = { engines:[] };
        // check engine
        platform.split('|').forEach(function(key){
            var arr = key.split('-'),
                eng = _pMap[arr[0]];
            if (ret.engines.indexOf(eng)<0){
                ret.engines.push(eng);
            }
        });
        // td-0 -> TR>=3.0 (ie>=7)
        // td-1 -> TR>=6.0 (ie>=10)
        if (platform.indexOf('td-0')>=0){
            ret.lower = '3.0';
        }
        if (platform==='win'||
            platform.indexOf('td-1')>=0){
            ret.lower = '6.0';
        }
        return ret;
    };
})();
/**
 * parse nej patch version expression
 * result properties
 * - engine     patch supported engine expression
 * - version    patch supported version expression
 * - lower      lower version config, eg. {value:'3.0',eq:true}
 * - middle     middle version config, eg. {value:'5.0',eq:true}
 * - upper      upper version config, eg. {value:'6.0',eq:true}
 * @param  {String} expression - version expression
 * @return {Object} result of expression
 */
exports.parseExpression = (function(){
    var _vMap = {r:'release',v:'version'},
        _cMap = {t:'trident',w:'webkit',g:'gecko'},
        _fMap = [
            // for 2.0a<= or 2.0a= or 2.0a>=
            function(result,exp){
                switch(exp.op){
                    case '<':
                    case '<=':
                        result.lower = exp;
                    break;
                    case '>':
                    case '>=':
                        result.upper = exp;
                    break;
                    case '=':
                    case '==':
                        result.midle = exp;
                    break;
                }
                delete exp.op;
            },
            // for <=2.0a or =2.0a or >=2.0a
            function(result,exp){
                switch(exp.op){
                    case '<':
                    case '<=':
                        // check over write upper
                        var upper = result.upper;
                        if (!upper||exp.value<=upper.value){
                            result.upper = exp;
                            if (!!upper){
                                exp.eq = upper.eq&&exp.eq;
                            }
                        }
                    break;
                    case '>':
                    case '>=':
                        // check over write lower
                        var lower = result.lower;
                        if (!lower||exp.value>=lower.value){
                            result.lower = exp;
                            if (!!lower){
                                exp.eq = lower.eq&&exp.eq;
                            }
                        }
                    break;
                    case '=':
                    case '==':
                        // check over write lower
                        var midle = result.midle;
                        if (!midle){
                            result.midle = exp;
                        }else if(midle.value!==exp.value){
                            result.dirty = !0;
                            delete result.midle;
                        }
                    break;
                }
                delete exp.op;
            }
        ];
    return function(expression){
        var exp = (expression||'').replace(/\s/g,'').toLowerCase();
        if (!/(tr|wr|gr|tv|wv|gv)/i.test(exp)){
            return null;
        }
        // parse expresion to platfrom
        var ret = {},
            eng = RegExp.$1.toLowerCase(),
            arr = eng.split('');
        ret.engine = _cMap[arr[0]]||'';
        // for TR or GR or WR
        if (eng===exp){
            return ret;
        }
        // for TR=3.0 or 2.0<=TR<=4.0
        ret.version = _vMap[arr[1]]||'release';
        // check version condition
        var ver = /([<>=]+)/;
        exp.split(eng).forEach(function(value,index){
            if (!ver.test(value)){
                return;
            }
            var op = RegExp.$1,
                vl = value.replace(op,'');
            _fMap[index](ret,{
                value:vl,op:op,
                eq:op.indexOf('=')>=0
            });
        });
        return !ret.dirty?ret:null;
    };
})();
/**
 * check expression fit to platform
 * @param  {Object}  exp - expression parse result
 * @param  {Object}  platform - platform parse result
 * @return {Boolean} is expression fit to platform
 */
exports.isExpFitPlatform = function(exp,platform){
    // check string exp and platform
    if (typeof exp==='string'){
        exp = this.parseExpression(exp);
    }
    if (typeof platform==='string'){
        platform = this.parsePlatform(platform);
    }
    // check engine
    var engines = platform.engines,
        index = engines.indexOf(exp.engine);
    // engine not match
    if (index<0){
        return !1;
    }
    // check version
    var lower = platform.lower;
    if (lower==null){
        return !0;
    }
    // check upper
    var upper = exp.upper;
    if (!!upper){
        if (upper.value<lower||
            (upper.value==lower&&!upper.eq)){
            return !1;
        }
        return !0;
    }
    // check middle
    var midle = exp.midle;
    if (!!midle&&midle.value<lower){
        return !1;
    }
    return !0;
};
/**
 * stringify expression to condition
 * @param  {String} name - name of platform argument name
 * @param  {Object} exp - expression parse result
 * @return {String} condition expression
 */
exports.exp2condition = function(name,exp){
    if (typeof exp==='string'){
        exp = this.parseExpression(exp);
    }
    var ret = util.format(
            "%s._$KERNEL.engine==='%s'",
            name,exp.engine
        ),
        ver = util.format(
            '%s._$KERNEL.%s',
            name,exp.version||'release'
        ),
        arr = [];
    // check lower
    var lower = exp.lower;
    if (!!lower){
        arr.push(
            util.format(
                "%s>%s'%s'",
                ver,lower.eq?'=':'',
                lower.value
            )
        );
    }
    // check middle
    var midle = exp.midle;
    if (!!midle){
        arr.push(ver+"=='"+midle.value+"'");
    }
    // check upper
    var upper = exp.upper;
    if (!!upper){
        arr.push(
            util.format(
                "%s<%s'%s'",
                ver,upper.eq?'=':'',
                upper.value
            )
        );
    }
    // suffix
    var other = '';
    if (arr.length>0){
        other = '&&'+arr.join('&&');
    }
    return ret+other;
};
/**
 * dependency list to injector arguments list
 * @param  {Array} list - dependency list
 * @return {Array} injector arguments list
 */
exports.deps2injector = function(list){
    var ret = [];
    (list||[]).forEach(function(item){
        var uri = item.uri;
        // inject patch file for platform patch
        if (!!item.patch){
            uri = item.patch;
        }
        var key = _fs.key(
            (item.plugin||'')+uri
        );
        ret.push(key);
    });
    return ret;
};