var _ = require('underscore');
var mongoose = require('mongoose');
var express = require('express');
var fs = require('fs');
var mustache = require('mustache');
var passwordHasher = require('password-hash');

var ChatServer = require('./chatServer.js');
var forms = require('./forms.js');

var User = require('./models/auth.js');

var MemoryStore = express.session.MemoryStore;

var requireLogin = function (req, res, next) {
    if (req.session.user) {
        next();
    } else {
        res.redirect('/login?next=' + req.path);
    }
};

var Server = function (config) {

    var self = this;

    this.config = config;

    this.template = (function (templateRoot) {
        var cache = {};
        return function (file) {
            if (cache[file] && !config.debug) {
                return cache[file];
            } else {
                cache[file] = fs.readFileSync('views/' + file).toString();
                return cache[file];
            }
        };
    }(config.templateRoot));

	// Setup express
	var app = express.createServer();
	self.app = app;

	var sessionStore = new MemoryStore();
	self.sessionStore = sessionStore;
	
	// Express options
	app.use(express.bodyParser());
	app.use(express.cookieParser());
	app.use(express.session({
		key: 'express.sid',
		cookie: {
			httpOnly: false // We have to turn off httpOnly for websockets
		}, 
		secret: self.config.cookie_secret,
		store: sessionStore
	}));
	app.use('/media', express.static('media'));
	
	// Login
	app.all('/login', function (req, res) {
		var render_login_page = function (errors) {
			var cxt = {
				'sitename': self.config.sitename,
				'media_url': self.config.media_url,
				'next': req.param('next', ''),
				'errors': errors
			};
			return mustache.to_html(self.template('login.html'), cxt);
		};
		if (req.method === 'POST') {
			var form = forms.loginForm.bind(req.body);
			if (form.isValid()) {
				User.findOne({ 'username': form.data.username }).run(function (error, user) {
					if (user && passwordHasher.verify(form.data.password, user.password)) {
						req.session.user = user;
						req.session.save();
						res.redirect(form.data.next);
					} else {
						res.send(render_login_page());
					}
				});
			} else {
				res.send(render_login_page());
			}
		} else {
			res.send(render_login_page());
		}
		// TODO: fix the if statement logic here
	});
	
	// Logout
	app.all('/logout', function (req, res) {
		req.session.destroy();
		res.redirect('/login');
	});
	
	// Register
	app.post('/register', function (req, res) {
		var form = forms.registrationForm.bind(req.body);
		var passwordHash = passwordHasher.generate(form.data.password);
		var user = new User({
			'username': form.data.username,
			'password': passwordHash,
			'firstName': form.data.firstName,
			'lastName': form.data.lastName,
			'displayName': form.data.firstName
		}).save();
		req.session.user = user;
		req.session.save();
		res.redirect(req.param('next'));
	});
	
	// Home Sweet Home
	app.get('/', requireLogin, function (req, res) {
		var cxt = {
			'host': self.config.hostname,
			'port': self.config.port,
			'media_url': self.config.media_url,
			'sitename': self.config.sitename,
			'page_title': 'Development',
			'js_templates': self.template('js-templates.html'),
			'user': req.session.user.displayName
		};
		res.send(mustache.to_html(self.template('chat.html'), cxt, {
			'header': self.template('header.html'),
			'footer': self.template('footer.html')
		}));
	});

    this.start = function () {

		// Connect to mongo
		var db = 'mongodb://' + self.config.db_host + '/' + self.config.db_name;
		mongoose.connect(db, function(err) {
			if (err) throw err;
		});

		// Go go go!
        self.app.listen(config.port);
        self.chatServer = new ChatServer(self.app, self.sessionStore).start();

    };

};

module.exports = Server;
