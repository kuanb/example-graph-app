import React from 'react';
import ReactDOM from 'react-dom';

import App from './App';
import './App.css';

import 'font-awesome/css/font-awesome.min.css';

// import axios from 'axios'
// axios.get('https://api.github.com/users/maecapozzi')
//     .then(response => console.log({username: response.data.name}))

// Bind app parent component to the root div
ReactDOM.render(<App />, document.getElementById('root'));
